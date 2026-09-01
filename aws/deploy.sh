#!/usr/bin/env bash
# Deploy the Trip Planner to AWS Lambda.
#
# Requires: AWS CLI configured with credentials that can manage Lambda/IAM
# (see aws/iam-policy.json for a scoped-down example), and ORS_API_KEY set
# in the environment — never hardcode it here or commit it anywhere.
#
# Usage:
#   export ORS_API_KEY=your-key-here
#   ./aws/deploy.sh
#
set -euo pipefail

FUNCTION_NAME="${FUNCTION_NAME:-trip-planner-app}"
REGION="${AWS_REGION:-us-east-1}"
RUNTIME="nodejs20.x"
ROLE_NAME="${ROLE_NAME:-trip-planner-app-role}"
# The original 10s default was fine for the DynamoDB-only routes, but the
# Bedrock AI features (summarize-day, summarize-trip) can genuinely take
# longer than that to generate a response — confirmed via CloudWatch logs
# showing real `Status: timeout` entries at exactly 10000ms on the trip
# recap, which has a bigger prompt and a higher token budget than the
# day summary. If you raise this further, also raise the CloudFront
# distribution's origin read timeout (console: Origins > Edit > "Origin
# read timeout") to comfortably exceed it — CloudFront's own default for a
# custom origin is 30s and its hard maximum is 60s, so this Lambda timeout
# should stay under whatever that's set to or CloudFront will 502 the
# request before the Lambda gets a chance to respond.
LAMBDA_TIMEOUT="${LAMBDA_TIMEOUT:-45}"

if [[ -z "${ORS_API_KEY:-}" ]]; then
  echo "ERROR: set ORS_API_KEY in your environment before running this script." >&2
  echo "       export ORS_API_KEY=your-key-here" >&2
  exit 1
fi

# This script replaces the Lambda's entire environment on every run
# (update-function-configuration is not additive), so a var that isn't
# exported at deploy time gets silently WIPED from production. That bit
# SESSION_SECRET (logged everyone out), GOOGLE_CLIENT_ID (broke sign-in),
# and BEDROCK_MODEL_ID (broke AI) on separate occasions — so now a missing
# required var fails the deploy instead. Locally: `set -a && source .env`.
# CI: each var comes from a same-named GitHub Actions secret — add the
# secret in the same change that introduces a new var.
#
# ALLOW_MISSING_ENV=1 skips the check for intentional cases (e.g. standing
# up a fresh stack that has no auth/AI configured yet).
#
# AUTH_DEV_FAKE is deliberately never forwarded — dev-only escape hatch
# that must not exist in production.
REQUIRED_ENV_VARS=(SESSION_SECRET GOOGLE_CLIENT_ID ADMIN_EMAILS ADMIN_TOKEN BEDROCK_MODEL_ID)
# TRIPS_TABLE etc. let a parallel stack (e.g. the beta deployment) point at
# its own tables instead of colliding with the default trip-planner-app-*
# names; SYNC_SOURCE_PREFIX is beta-only (see aws/store.mjs) — its presence
# is what turns on the backoffice "sync from mainline" button. DEPLOY_ENV
# drives the "BETA" badge + accent-color swap in the UI (index.html).
OPTIONAL_ENV_VARS=(USERS_TABLE TRIPS_TABLE VARIANTS_TABLE SHARES_TABLE TICKETS_TABLE SYNC_SOURCE_PREFIX DEPLOY_ENV)

missing=()
for var in "${REQUIRED_ENV_VARS[@]}"; do
  [[ -n "${!var:-}" ]] || missing+=("$var")
done
if [[ ${#missing[@]} -gt 0 && "${ALLOW_MISSING_ENV:-}" != "1" ]]; then
  echo "ERROR: missing required env vars: ${missing[*]}" >&2
  echo "       Deploying now would wipe them from the Lambda (its environment" >&2
  echo "       is replaced whole on every deploy). Export them first (locally:" >&2
  echo "       set -a && source .env; CI: add the GitHub Actions secret), or" >&2
  echo "       set ALLOW_MISSING_ENV=1 to deploy without them on purpose." >&2
  exit 1
fi

LAMBDA_ENV="ORS_API_KEY=$ORS_API_KEY"
for var in "${REQUIRED_ENV_VARS[@]}" "${OPTIONAL_ENV_VARS[@]}"; do
  if [[ -n "${!var:-}" ]]; then
    LAMBDA_ENV="$LAMBDA_ENV,$var=${!var}"
  fi
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Packaging function..."
rm -rf build function.zip
mkdir build
cp aws/handler.mjs build/index.mjs
cp aws/validate.mjs build/validate.mjs
cp aws/auth.mjs build/auth.mjs
cp aws/store.mjs build/store.mjs
cp aws/ai.mjs build/ai.mjs
cp index.html build/index.html
cp aws/sw.js build/sw.js
cp aws/manifest.webmanifest build/manifest.webmanifest
cp aws/icon.svg build/icon.svg
(cd build && zip -qr ../function.zip .)
rm -rf build

echo "==> Ensuring IAM role exists..."
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]
    }' >/dev/null
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null
  echo "    created role, waiting for IAM propagation..."
  sleep 10
fi
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)

echo "==> Deploying function code..."
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://function.zip \
    --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"

  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "Variables={$LAMBDA_ENV}" \
    --timeout "$LAMBDA_TIMEOUT" \
    --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
else
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file fileb://function.zip \
    --timeout "$LAMBDA_TIMEOUT" \
    --memory-size 256 \
    --environment "Variables={$LAMBDA_ENV}" \
    --region "$REGION" >/dev/null
  aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
fi

echo "==> Ensuring DynamoDB tables + role access (auth-and-sharing)..."
# Tolerant of missing permissions: warns and continues so deploys keep
# working until the unified aws/iam-policy.json is attached to the deployer.
ensure_table() {
  local name="$1"; shift
  if ! aws dynamodb describe-table --table-name "$name" --region "$REGION" >/dev/null 2>&1; then
    if aws dynamodb create-table --table-name "$name" --region "$REGION" \
        --billing-mode PAY_PER_REQUEST "$@" >/dev/null 2>&1; then
      echo "    created table $name"
    else
      echo "    WARNING: could not create table $name (missing DynamoDB perms? see aws/iam-policy.json)" >&2
    fi
  fi
}
ensure_table "${USERS_TABLE:-trip-planner-app-users}" \
  --attribute-definitions AttributeName=sub,AttributeType=S \
  --key-schema AttributeName=sub,KeyType=HASH
ensure_table "${TRIPS_TABLE:-trip-planner-app-trips}" \
  --attribute-definitions AttributeName=trip_id,AttributeType=S \
  --key-schema AttributeName=trip_id,KeyType=HASH
ensure_table "${VARIANTS_TABLE:-trip-planner-app-variants}" \
  --attribute-definitions AttributeName=trip_id,AttributeType=S AttributeName=variant_id,AttributeType=S \
  --key-schema AttributeName=trip_id,KeyType=HASH AttributeName=variant_id,KeyType=RANGE
ensure_table "${SHARES_TABLE:-trip-planner-app-shares}" \
  --attribute-definitions AttributeName=trip_id,AttributeType=S AttributeName=email,AttributeType=S \
  --key-schema AttributeName=trip_id,KeyType=HASH AttributeName=email,KeyType=RANGE
ensure_table "${TICKETS_TABLE:-trip-planner-app-tickets}" \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH

if ! aws iam put-role-policy --role-name "$ROLE_NAME" \
    --policy-name trip-planner-app-dynamodb \
    --policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Action": ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:Query","dynamodb:Scan"],
        "Resource": "arn:aws:dynamodb:*:*:table/trip-planner-app-*"
      }]
    }' >/dev/null 2>&1; then
  echo "    WARNING: could not attach DynamoDB policy to $ROLE_NAME (missing iam:PutRolePolicy?)" >&2
fi

echo "==> Ensuring Bedrock invoke access (AI features)..."
# Invoke is scoped to specific model families (both the plain foundation-model
# ARN and the cross-region inference-profile ARN each requires) — Claude
# Haiku 4.5 (the original default), Claude Sonnet 4.5 (switched to for better
# prose quality on the AI recap features; see BEDROCK_MODEL_ID below), and
# Claude Sonnet 5 (the actual target — allowlisted ahead of time, but its
# invoke kept returning AccessDeniedException "not available for this
# account" even after accepting its model-access EULA via
# create-foundation-model-agreement and confirming all four
# get-foundation-model-availability flags green; Sonnet 4.5 invoked
# successfully immediately under the same account/role, so this looks like
# slow account-level provisioning specific to a very new model rather than a
# permissions problem — revisit switching BEDROCK_MODEL_ID to Sonnet 5 later
# without needing another IAM edit, since its ARN pattern is already here).
# All three stay allowlisted rather than narrowing to just the active one, so
# changing BEDROCK_MODEL_ID between them doesn't also need an IAM edit. The
# aws-marketplace actions are what replaced the retired Bedrock console
# "Model access" page: model subscription now happens automatically on the
# first invoke, but only if the invoking role may Subscribe — without them,
# invokes fail intermittently depending on which region of the inference
# profile the request lands in. Marketplace actions only accept Resource "*";
# the role is only assumable by this Lambda, which only invokes these models.
if ! aws iam put-role-policy --role-name "$ROLE_NAME" \
    --policy-name trip-planner-app-bedrock \
    --policy-document '{
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
          "Resource": [
            "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5*",
            "arn:aws:bedrock:*:*:inference-profile/*anthropic.claude-haiku-4-5*",
            "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-5*",
            "arn:aws:bedrock:*:*:inference-profile/*anthropic.claude-sonnet-5*",
            "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-5*",
            "arn:aws:bedrock:*:*:inference-profile/*anthropic.claude-sonnet-4-5*"
          ]
        },
        {
          "Effect": "Allow",
          "Action": ["aws-marketplace:Subscribe", "aws-marketplace:ViewSubscriptions"],
          "Resource": "*"
        }
      ]
    }' >/dev/null 2>&1; then
  echo "    WARNING: could not attach Bedrock policy to $ROLE_NAME (missing iam:PutRolePolicy?)" >&2
fi

echo "==> Ensuring public Function URL exists..."
if ! aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda create-function-url-config \
    --function-name "$FUNCTION_NAME" \
    --auth-type NONE \
    --region "$REGION" >/dev/null
  aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id FunctionURLAllowPublicAccess \
    --action lambda:InvokeFunctionUrl \
    --principal "*" \
    --function-url-auth-type NONE \
    --region "$REGION" >/dev/null
  # Public Function URLs need both InvokeFunctionUrl and InvokeFunction granted
  # to "*" - AWS returns AccessDeniedException on every request if only the
  # former is present, even though AuthType NONE and the URL config look correct.
  aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id FunctionURLAllowPublicInvoke \
    --action lambda:InvokeFunction \
    --principal "*" \
    --region "$REGION" >/dev/null
fi

URL=$(aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" --query 'FunctionUrl' --output text)

rm -f function.zip

echo ""
echo "Deployed. Your app is live at:"
echo "$URL"
