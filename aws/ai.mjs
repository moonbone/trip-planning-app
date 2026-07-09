// AWS Bedrock invocation for the (currently owner-only) AI features.
//
// Uses the AWS SDK v3 bedrock-runtime client, which ships pre-bundled in the
// Lambda Node.js runtime, so it needs no npm dependency — the same pattern
// store.mjs uses for @aws-sdk/client-dynamodb (see its dynamo() helper).

let bedrockClient = null;
async function client() {
  if (!bedrockClient) {
    const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
    bedrockClient = { rt: new BedrockRuntimeClient({}), InvokeModelCommand };
  }
  return bedrockClient;
}

// Sends a single-turn prompt to the configured Claude model and returns its
// text response. modelId comes from BEDROCK_MODEL_ID (set at deploy time) —
// look up the exact ID for your enabled model in the Bedrock console's model
// catalog (it includes a dated suffix, e.g. "anthropic.claude-haiku-4-5-...-v1:0").
export async function askClaude(prompt, { maxTokens = 400 } = {}) {
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) throw new Error('BEDROCK_MODEL_ID not configured on this Lambda');
  const { rt, InvokeModelCommand } = await client();
  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const res = await rt.send(command);
  const payload = JSON.parse(new TextDecoder().decode(res.body));
  const text = payload.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('empty response from model');
  return text;
}
