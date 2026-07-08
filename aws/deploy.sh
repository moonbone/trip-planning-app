#!/usr/bin/env bash
# Deploy the Norway Route Planner to AWS Lambda.
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

FUNCTION_NAME="${FUNCTION_NAME:-norway-route-app}"
REGION="${AWS_REGION:-us-east-1}"
# Feature-request tickets (aws/tickets-db.mjs) are intentionally disabled on
# this deployment: node:sqlite needs Node 22.5+ and a writable filesystem,
# neither of which nodejs20.x Lambda has (read-only outside ephemeral /tmp).
# tickets-db.mjs detects that at runtime and disables itself gracefully
# (returns 503 on /tickets) rather than crashing the whole function - so
# nodejs20.x is fine here. Tickets only work via local/laptop hosting
# (dev-server.mjs) for now; a real Lambda deployment would need
# DynamoDB/RDS/EFS instead of SQLite.
RUNTIME="nodejs20.x"
ROLE_NAME="${ROLE_NAME:-norway-route-app-role}"

if [[ -z "${ORS_API_KEY:-}" ]]; then
  echo "ERROR: set ORS_API_KEY in your environment before running this script." >&2
  echo "       export ORS_API_KEY=your-key-here" >&2
  exit 1
fi

# Auth-related env vars (auth-and-sharing effort) are passed through when
# present. AUTH_DEV_FAKE is deliberately never forwarded — dev-only escape
# hatch that must not exist in production.
#
# IMPORTANT: this script replaces the Lambda's entire environment on every
# run (update-function-configuration is not additive). SESSION_SECRET must
# therefore be a *stable* value you export the same way every deploy (e.g.
# keep it in a gitignored local var/secrets file) — regenerating it each
# run silently invalidates every signed-in user's session.
LAMBDA_ENV="ORS_API_KEY=$ORS_API_KEY"
for var in SESSION_SECRET GOOGLE_CLIENT_ID ADMIN_EMAILS ADMIN_TOKEN USERS_TABLE; do
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
cp aws/tickets-db.mjs build/tickets-db.mjs
cp aws/auth.mjs build/auth.mjs
cp aws/store.mjs build/store.mjs
cp index.html build/index.html
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
    --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
else
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file fileb://function.zip \
    --timeout 10 \
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
ensure_table norway-app-users \
  --attribute-definitions AttributeName=sub,AttributeType=S \
  --key-schema AttributeName=sub,KeyType=HASH
ensure_table norway-app-trips \
  --attribute-definitions AttributeName=trip_id,AttributeType=S \
  --key-schema AttributeName=trip_id,KeyType=HASH
ensure_table norway-app-variants \
  --attribute-definitions AttributeName=trip_id,AttributeType=S AttributeName=variant_id,AttributeType=S \
  --key-schema AttributeName=trip_id,KeyType=HASH AttributeName=variant_id,KeyType=RANGE
ensure_table norway-app-shares \
  --attribute-definitions AttributeName=trip_id,AttributeType=S AttributeName=email,AttributeType=S \
  --key-schema AttributeName=trip_id,KeyType=HASH AttributeName=email,KeyType=RANGE

if ! aws iam put-role-policy --role-name "$ROLE_NAME" \
    --policy-name norway-app-dynamodb \
    --policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Action": ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:Query","dynamodb:Scan"],
        "Resource": "arn:aws:dynamodb:*:*:table/norway-app-*"
      }]
    }' >/dev/null 2>&1; then
  echo "    WARNING: could not attach DynamoDB policy to $ROLE_NAME (missing iam:PutRolePolicy?)" >&2
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
