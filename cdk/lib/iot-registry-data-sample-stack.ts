import * as cdk from 'aws-cdk-lib';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export class IotRegistryDataSampleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Thing名とThingGroup名を定義
    const thingName = 'test-device-001';
    const thingGroupName = 'production-devices';

    // IoT Thing Groupの作成
    const thingGroup = new iot.CfnThingGroup(this, 'ProductionDeviceGroup', {
      thingGroupName: thingGroupName,
      thingGroupProperties: {
        attributePayload: {
          attributes: {
            environment: 'production',
            priority: 'high',
          },
        },
        thingGroupDescription: 'Production environment devices',
      },
    });

    // IoT Thingの作成（属性付き）
    const thing = new iot.CfnThing(this, 'TestDevice', {
      thingName: thingName,
      attributePayload: {
        attributes: {
          deviceType: 'sensor',
          location: 'Tokyo',
          firmwareVersion: '1.2.3',
        },
      },
    });

    // IoT Policyの作成
    const iotPolicy = new iot.CfnPolicy(this, 'DevicePolicy', {
      policyName: `${thingName}-policy`,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['iot:Connect'],
            Resource: [`arn:aws:iot:${this.region}:${this.account}:client/${thingName}`],
          },
          {
            Effect: 'Allow',
            Action: ['iot:Publish'],
            Resource: [`arn:aws:iot:${this.region}:${this.account}:topic/device/${thingName}/telemetry`],
          },
          {
            Effect: 'Allow',
            Action: ['iot:Subscribe'],
            Resource: [`arn:aws:iot:${this.region}:${this.account}:topicfilter/device/${thingName}/#`],
          },
          {
            Effect: 'Allow',
            Action: ['iot:Receive'],
            Resource: [`arn:aws:iot:${this.region}:${this.account}:topic/device/${thingName}/#`],
          },
        ],
      },
    });

    // get_registry_data用の統合IAMロール
    const registryDataRole = new iam.Role(this, 'RegistryDataRole', {
      roleName: 'GetRegistryDataRole',
      assumedBy: new iam.ServicePrincipal('iot.amazonaws.com'),
      description: 'Unified role for get_registry_data() function to access Thing registry',
    });

    // get_registry_data()で必要な権限を付与
    registryDataRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'iot:DescribeThing',
          'iot:ListThingGroupsForThing',
        ],
        resources: ['*'],
      })
    );

    // 統合Lambda関数の作成
    const getRegistryDataFunction = new lambda.Function(this, 'GetRegistryDataFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'log-event.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      functionName: 'GetRegistryDataFunction',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'Unified Lambda function for logging IoT Rule events with registry data',
      logGroup: new logs.LogGroup(this, 'GetRegistryDataFunctionLogGroup', {
        logGroupName: '/aws/lambda/GetRegistryDataFunction',
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Lambda呼び出し権限を付与（IoTサービスからの呼び出しを許可）
    getRegistryDataFunction.addPermission('IoTInvokePermission', {
      principal: new iam.ServicePrincipal('iot.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:iot:${this.region}:${this.account}:rule/*`,
    });

    // IoT Rule 1: DescribeThing API用
    const describeThingRule = new iot.CfnTopicRule(this, 'DescribeThingRule', {
      ruleName: 'DescribeThingRule',
      topicRulePayload: {
        sql: `
          SELECT
            *,
            clientId,
            timestamp,
            'DESCRIBE_THING' as rule_type,
            get_registry_data("DescribeThing", '${thingName}', '${registryDataRole.roleArn}') as deviceInfo
          FROM
            'device/+/telemetry'
        `,
        description: 'Test get_registry_data("DescribeThing") API',
        actions: [
          {
            lambda: {
              functionArn: getRegistryDataFunction.functionArn,
            },
          },
        ],
        ruleDisabled: false,
        awsIotSqlVersion: '2016-03-23',
      },
    });

    // IoT Rule 2: ListThingGroupsForThing API用
    const listThingGroupsRule = new iot.CfnTopicRule(this, 'ListThingGroupsForThingRule', {
      ruleName: 'ListThingGroupsForThingRule',
      topicRulePayload: {
        sql: `
          SELECT
            *,
            clientId,
            timestamp,
            'LIST_THING_GROUPS' as rule_type,
            get_registry_data("ListThingGroupsForThing", '${thingName}', '${registryDataRole.roleArn}') as deviceGroups
          FROM
            'device/+/telemetry'
        `,
        description: 'Test get_registry_data("ListThingGroupsForThing") API',
        actions: [
          {
            lambda: {
              functionArn: getRegistryDataFunction.functionArn,
            },
          },
        ],
        ruleDisabled: false,
        awsIotSqlVersion: '2016-03-23',
      },
    });

    // 出力
    new cdk.CfnOutput(this, 'ThingName', {
      value: thingName,
      description: 'IoT Thing Name',
    });

    new cdk.CfnOutput(this, 'ThingGroupName', {
      value: thingGroupName,
      description: 'IoT Thing Group Name',
    });

    new cdk.CfnOutput(this, 'PolicyName', {
      value: iotPolicy.policyName!,
      description: 'IoT Policy Name',
    });

    new cdk.CfnOutput(this, 'GetRegistryDataRoleArn', {
      value: registryDataRole.roleArn,
      description: 'IAM Role ARN for get_registry_data()',
    });

    new cdk.CfnOutput(this, 'GetRegistryDataFunctionName', {
      value: getRegistryDataFunction.functionName,
      description: 'Lambda Function Name for Registry Data',
    });

    new cdk.CfnOutput(this, 'DescribeThingRuleName', {
      value: describeThingRule.ruleName!,
      description: 'IoT Rule Name (DescribeThing)',
    });

    new cdk.CfnOutput(this, 'ListThingGroupsRuleName', {
      value: listThingGroupsRule.ruleName!,
      description: 'IoT Rule Name (ListThingGroupsForThing)',
    });

    new cdk.CfnOutput(this, 'PublishTopic', {
      value: `device/${thingName}/telemetry`,
      description: 'MQTT Topic to publish messages',
    });

    // IoT Endpointを出力用に取得（カスタムリソース使用）
    const iotEndpointResource = new cdk.CustomResource(this, 'IoTEndpointResource', {
      serviceToken: new cdk.custom_resources.Provider(this, 'IoTEndpointProvider', {
        onEventHandler: new lambda.Function(this, 'GetIoTEndpoint', {
          runtime: lambda.Runtime.PYTHON_3_12,
          handler: 'index.handler',
          code: lambda.Code.fromInline(`
import boto3
import json

iot_client = boto3.client('iot')

def handler(event, context):
    if event['RequestType'] in ['Create', 'Update']:
        response = iot_client.describe_endpoint(endpointType='iot:Data-ATS')
        return {
            'PhysicalResourceId': 'IoTEndpoint',
            'Data': {
                'Endpoint': response['endpointAddress']
            }
        }
    return {'PhysicalResourceId': 'IoTEndpoint'}
          `),
          timeout: cdk.Duration.seconds(30),
          initialPolicy: [
            new iam.PolicyStatement({
              actions: ['iot:DescribeEndpoint'],
              resources: ['*'],
            }),
          ],
        }),
      }).serviceToken,
    });

    new cdk.CfnOutput(this, 'IoTEndpoint', {
      value: iotEndpointResource.getAttString('Endpoint'),
      description: 'IoT Core MQTT Endpoint',
    });
  }
}
