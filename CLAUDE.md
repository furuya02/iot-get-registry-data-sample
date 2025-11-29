# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AWS IoT Core sample implementation demonstrating the `get_registry_data()` function with two different APIs: `DescribeThing` and `ListThingGroupsForThing`. This project validates how different IoT Rules can use registry data retrieval functions with IAM roles.

**Key Architecture**: Two separate IoT Rules invoke the same Lambda function, differentiated by a `rule_type` field in the SQL query.

## Project Structure

```
cdk/                    # AWS CDK infrastructure (TypeScript)
├── lib/                # CDK stack definition
├── lambda/             # Lambda function code
│   └── log-event.py    # Unified Lambda for both rules
client/                 # Python MQTT client
└── publish_message.py  # Device telemetry publisher
```

## Common Commands

### CDK Deployment

```bash
# Navigate to CDK directory
cd cdk

# Install dependencies
pnpm install

# Build TypeScript
pnpm run build

# Deploy infrastructure
cdk deploy

# View changes before deploying
cdk diff

# Destroy stack
cdk destroy
```

### Python Client Setup

```bash
cd client

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Send test messages
python publish_message.py \
  --endpoint <IOT_ENDPOINT> \
  --thing-name test-device-001 \
  --count 5 \
  --interval 2
```

### Manual Setup Steps (Required After CDK Deployment)

```bash
# 1. Add Thing to Thing Group (CDK doesn't support this directly)
aws iot add-thing-to-thing-group \
  --thing-name test-device-001 \
  --thing-group-name production-devices

# 2. Create device certificates
aws iot create-keys-and-certificate \
  --set-as-active \
  --certificate-pem-outfile client/certs/device.cert.pem \
  --private-key-outfile client/certs/device.private.key \
  --output json > certificate-output.json

# Get certificate ARN
CERT_ARN=$(cat certificate-output.json | jq -r '.certificateArn')

# 3. Download Root CA
curl -o client/certs/AmazonRootCA1.pem \
  https://www.amazontrust.com/repository/AmazonRootCA1.pem

# 4. Attach certificate to Thing
aws iot attach-thing-principal \
  --thing-name test-device-001 \
  --principal $CERT_ARN

# 5. Attach policy to certificate
aws iot attach-policy \
  --policy-name test-device-001-policy \
  --target $CERT_ARN
```

### Monitoring

```bash
# View Lambda logs (unified function for both rules)
aws logs tail /aws/lambda/GetRegistryDataFunction --follow

# View IoT Rule logs
aws logs tail AWSIotLogsV2 --follow --filter-pattern "RuleName"

# Get IoT endpoint
aws iot describe-endpoint --endpoint-type iot:Data-ATS
```

## Architecture Details

### IoT Rules Configuration

**Critical Limitation**: AWS IoT Rules can only call `get_registry_data()` once per rule. To retrieve multiple types of registry data, use separate rules.

This implementation uses **two separate IoT Rules** pointing to the **same Lambda function**:

1. **DescribeThingRule**: Retrieves Thing attributes via `get_registry_data("DescribeThing", thingName, roleArn)`
   - Returns: Thing attributes, ARN, version
   - Identified by: `rule_type: 'DESCRIBE_THING'`

2. **ListThingGroupsForThingRule**: Retrieves Thing Groups via `get_registry_data("ListThingGroupsForThing", thingName, roleArn)`
   - Returns: List of Thing Group names
   - Identified by: `rule_type: 'LIST_THING_GROUPS'`

### IAM Role Requirements

When using API syntax (`"DescribeThing"`, `"ListThingGroupsForThing"`), the `roleArn` parameter is **mandatory** (despite AWS documentation showing it as optional with brackets).

The role must have:
- Trust relationship with `iot.amazonaws.com`
- Permissions: `iot:DescribeThing` and `iot:ListThingGroupsForThing`

### Lambda Function Design

[log-event.py](cdk/lambda/log-event.py) is a unified handler that:
- Logs all incoming events to CloudWatch
- Identifies the source rule via the `rule_type` field injected by IoT Rule SQL
- Does not use environment variables for configuration

## Important Implementation Notes

### Thing Name in SQL Queries

The second parameter of `get_registry_data()` must be a valid Thing name:

```typescript
// Correct: Use actual Thing name
get_registry_data("DescribeThing", 'test-device-001', roleArn)

// Correct: Extract from topic pattern
get_registry_data("DescribeThing", topic(2), roleArn)  // for device/THING_NAME/telemetry

// Incorrect: clientId is MQTT client ID, not necessarily Thing name
get_registry_data("DescribeThing", clientId, roleArn)
```

### Multiple Registry Data Calls

**Cannot do this** (will error with "Rule cannot contain more than 1 get_registry_data function calls"):

```sql
SELECT
  get_registry_data("DescribeThing", thingName, roleArn) as deviceInfo,
  get_registry_data("ListThingGroupsForThing", thingName, roleArn) as deviceGroups
FROM 'device/+/telemetry'
```

**Solution**: Create separate rules for each API call (as implemented in this project).

## Testing Workflow

1. Deploy CDK stack: `cd cdk && cdk deploy`
2. Complete manual setup steps (certificates, Thing Group membership)
3. Send test messages: `cd client && python publish_message.py --endpoint <ENDPOINT> --thing-name test-device-001`
4. Monitor Lambda logs: `aws logs tail /aws/lambda/GetRegistryDataFunction --follow`
5. Verify both `rule_type` values appear in logs: `DESCRIBE_THING` and `LIST_THING_GROUPS`

## Troubleshooting

### "Get registry data requires its last parameter to be roleArn"

Cause: Missing `roleArn` parameter when using API syntax.
Solution: Always include roleArn as the third parameter.

### "Rule cannot contain more than 1 get_registry_data function calls"

Cause: Attempting to call `get_registry_data()` multiple times in a single rule.
Solution: Split into separate IoT Rules.

### Device cannot publish messages

Check:
1. Certificate files exist in `client/certs/`
2. Certificate is attached to Thing: `aws iot list-thing-principals --thing-name test-device-001`
3. Policy is attached to certificate: `aws iot list-attached-policies --target <CERT_ARN>`

### Thing Groups not appearing in results

Cause: Thing not added to Thing Group (CDK limitation).
Solution: Manually add with `aws iot add-thing-to-thing-group` command.
