# AWS IoT Core get_registry_data() サンプル実装

このプロジェクトは、AWS IoT Coreの`get_registry_data()`関数を使用して、デバイスのレジストリ情報を動的に取得するサンプル実装です。

**特徴**: 異なるAPI（`DescribeThing`と`ListThingGroupsForThing`）と異なるIAMロールの組み合わせを検証できます。

## 概要

IoTルール内で`get_registry_data()`を使用することで、以下のAPI相当の情報を取得できます:

- **`DescribeThing`**: デバイスの詳細情報（属性、ARN、バージョンなど）
- **`ListThingGroupsForThing`**: デバイスが所属するThingグループ一覧

### 構文

```sql
get_registry_data("DescribeThing", thingName, roleArn)
get_registry_data("ListThingGroupsForThing", thingName, roleArn)
```

**重要**: API名構文（`"DescribeThing"`, `"ListThingGroupsForThing"`）を使用する場合、**roleArnは必須パラメータ**です。

## アーキテクチャ

```
[IoTデバイス]
    ↓ (MQTT Publish: device/test-device-001/telemetry)
[IoT Core]
    ├─→ [IoT Rule 1: DescribeThing] →
    └─→ [IoT Rule 2: ListThingGroupsForThing] →
                                    ↓
                    [GetRegistryDataFunction (統合Lambda)]
                                    ↓
                            [CloudWatch Logs]
```

### リソース構成

- **IoT Thing**: `test-device-001` (属性: deviceType, location, firmwareVersion)
- **IoT Thing Group**: `production-devices` (属性: environment, priority)
- **IAM Role**: `GetRegistryDataRole` (統合IAMロール - DescribeThing/ListThingGroupsForThing API用)
- **IoT Rule 1**: `DescribeThingRule` - Thing情報を取得
- **IoT Rule 2**: `ListThingGroupsForThingRule` - Thingグループ一覧を取得
- **Lambda関数**: `GetRegistryDataFunction` (統合関数 - rule_typeフィールドで識別)
- **IoT Policy**: デバイスの接続・送信権限

## ディレクトリ構成

```
cdk/                        # CDK (TypeScript)
├── bin/                    # CDKエントリーポイント
├── lib/                    # CDKスタック定義
├── lambda/                 # Lambda関数コード
├── package.json
├── tsconfig.json
├── cdk.json
client/                     # Pythonクライアント
├── publish_message.py      # MQTTメッセージ送信スクリプト
├── requirements.txt        # 依存パッケージ（awsiotpythonsdk==1.5.4）
└── certs/                  # 証明書配置ディレクトリ
  └── .gitkeep
README.md                   # このファイル
```

## 前提条件

### 必要なツール

- Node.js 18以上
- Python 3.8以上
- AWS CLI 2.x
- AWS CDK CLI 2.100以上

### AWSアカウント設定

```bash
# AWS CLIの設定
aws configure

# CDKのブートストラップ（初回のみ）
cd src/cdk
cdk bootstrap
```

## セットアップ手順

### 1. CDKのデプロイ

```bash
# 依存関係のインストール
cd src/cdk
pnpm install

# デプロイ
cdk deploy

# 出力されたIoT Endpointをメモしてください
```

デプロイ後、以下の情報が出力されます:

- `ThingName`: IoT Thing名
- `ThingGroupName`: IoT Thing Group名
- `PolicyName`: IoT Policy名
- `RegistryDataRoleArn`: get_registry_data用IAMロールARN（明示的なレジストリアクセス用）
- `LambdaFunctionWithRole`: Lambda関数名（DescribeThing用）
- `LambdaFunctionWithoutRole`: Lambda関数名（ListThingGroupsForThing用）
- `IoTRuleWithRole`: IoTルール名（DescribeThing使用）
- `IoTRuleWithoutRole`: IoTルール名（ListThingGroupsForThing使用）
- `IoTEndpoint`: MQTT接続用エンドポイント
- `PublishTopic`: メッセージ送信先トピック


### 2. Thingをグループに追加

CDKでThingとThingGroupは作成されますが、メンバーシップの追加は手動で行います。

```bash
$ aws iot add-thing-to-thing-group \
  --thing-name test-device-001 \
  --thing-group-name production-devices

# 確認
$ aws iot list-thing-groups-for-thing --thing-name test-device-001
{
    "thingGroups": [
        {
            "groupName": "production-devices",
            "groupArn": "arn:aws:iot:ap-northeast-1:<YOUR_AWS_ACCOUNT_ID>:thinggroup/production-devices"
        }
    ]
}
```

### 3. デバイス証明書の作成

#### 3-1. 証明書と秘密鍵の作成

```bash
# 証明書の作成
$ aws iot create-keys-and-certificate \
  --set-as-active \
  --certificate-pem-outfile src/client/certs/device.cert.pem \
  --private-key-outfile src/client/certs/device.private.key \
  --output json > certificate-output.json

# 証明書ARNを取得（次のステップで使用）
$ CERT_ARN=$(cat certificate-output.json | jq -r '.certificateArn')
$ echo "Certificate ARN: $CERT_ARN"
Certificate ARN: arn:aws:iot:ap-northeast-1:<YOUR_AWS_ACCOUNT_ID>:cert/<YOUR_CERTIFICATE_ID>
```


#### 3-2. ルートCA証明書のダウンロード

```bash
# Amazon Root CA 1をダウンロード
curl -o src/client/certs/AmazonRootCA1.pem \
  https://www.amazontrust.com/repository/AmazonRootCA1.pem

```

#### 3-3. 証明書をThingにアタッチ

```bash
# 証明書をThingにアタッチ
aws iot attach-thing-principal \
  --thing-name test-device-001 \
  --principal $CERT_ARN
```

#### 3-4. ポリシーを証明書にアタッチ

```bash
# ポリシーを証明書にアタッチ
aws iot attach-policy \
  --policy-name test-device-001-policy \
  --target $CERT_ARN
```


#### 3-5. 証明書ファイルの確認

```bash
ls -la src/client/certs/
# 以下のファイルが存在することを確認:
# - device.cert.pem
# - device.private.key
# - AmazonRootCA1.pem
```

### 4. Pythonクライアントのセットアップ

```bash
cd src/client

# 仮想環境の作成（推奨）
python3 -m venv venv
source venv/bin/activate  
# 依存関係のインストール
pip install -r requirements.txt
```

## 実行方法

### 1. メッセージの送信

```bash
cd src/client

# IoT Endpointは、CDKデプロイ時の出力または以下のコマンドで取得
IOT_ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --query 'endpointAddress' --output text)

# メッセージ送信
python publish_message.py \
  --endpoint $IOT_ENDPOINT \
  --thing-name test-device-001 \
  --count 5 \
  --interval 2
```

### 2. CloudWatch Logsで結果を確認

**統合Lambda関数のログを確認します:**

```bash
# GetRegistryDataFunctionのログを確認
aws logs tail /aws/lambda/GetRegistryDataFunction --follow
```

ログ内の`rule_type`フィールドで、どのIoT Ruleから呼び出されたかを確認できます：
- `DESCRIBE_THING`: DescribeThingRuleから呼び出された場合
- `LIST_THING_GROUPS`: ListThingGroupsForThingRuleから呼び出された場合

## 第3パラメータ（roleArn）の検証

このサンプルでは、`get_registry_data()`の異なるAPI（`DescribeThing`と`ListThingGroupsForThing`）と異なるIAMロールの組み合わせを検証できます。

### 重要な制限事項

**IoT Ruleでは`get_registry_data()`を1ルールにつき1回のみ使用可能**です。複数のAPI呼び出しを同時に行うことはできません。

このサンプルでは、2つの異なるルールで異なるAPIを使用しています:
- Rule 1: `DescribeThing` - Thing情報を取得
- Rule 2: `ListThingGroupsForThing` - Thingグループ一覧を取得

### IoT Rule 1: DescribeThing

```sql
SELECT
  *,
  clientId,
  timestamp,
  'DESCRIBE_THING' as rule_type,
  get_registry_data("DescribeThing", 'test-device-001', 'arn:aws:iam::xxx:role/GetRegistryDataRole') as deviceInfo
FROM
  'device/+/telemetry'
```

**特徴**:
- `DescribeThing` APIを使用してThing情報を取得
- 統合IAMロール（`GetRegistryDataRole`）を使用
- Thing属性、ThingType、ARN、バージョンなどを取得
- `rule_type`フィールドでルールを識別

### IoT Rule 2: ListThingGroupsForThing

```sql
SELECT
  *,
  clientId,
  timestamp,
  'LIST_THING_GROUPS' as rule_type,
  get_registry_data("ListThingGroupsForThing", 'test-device-001', 'arn:aws:iam::xxx:role/GetRegistryDataRole') as deviceGroups
FROM
  'device/+/telemetry'
```

**特徴**:
- `ListThingGroupsForThing` APIを使用してThingグループ一覧を取得
- 統合IAMロール（`GetRegistryDataRole`）を使用
- デバイスが所属するThingグループのリストを取得
- `rule_type`フィールドでルールを識別

### 比較ポイント

| 項目 | Rule 1 (DescribeThing) | Rule 2 (ListThingGroupsForThing) |
|------|------------------------|----------------------------------|
| 取得API | DescribeThing | ListThingGroupsForThing |
| 取得情報 | Thing属性、Type、ARNなど | Thingグループ一覧 |
| IAMロール | GetRegistryDataRole（統合） | GetRegistryDataRole（統合） |
| Lambda関数 | GetRegistryDataFunction（統合） | GetRegistryDataFunction（統合） |
| 識別方法 | rule_type='DESCRIBE_THING' | rule_type='LIST_THING_GROUPS' |

### ログ出力例

#### Rule 1 (DescribeThing) の場合

```json
{
  "rule_type": "DESCRIBE_THING",
  "device_id": "test-device-001",
  "has_device_info": true,
  "has_device_groups": false,
  "deviceInfo": {
    "thingName": "test-device-001",
    "thingArn": "arn:aws:iot:ap-northeast-1:<YOUR_AWS_ACCOUNT_ID>:thing/test-device-001",
    "attributes": {
      "deviceType": "sensor",
      "location": "Tokyo",
      "firmwareVersion": "1.2.3"
    },
    "version": 1
  }
}
```

#### Rule 2 (ListThingGroupsForThing) の場合

```json
{
  "rule_type": "LIST_THING_GROUPS",
  "device_id": "test-device-001",
  "has_device_info": false,
  "has_device_groups": true,
  "deviceGroups": ["production-devices"]
}
```

**注**:
- Rule 1では`DescribeThing`を使用するため`deviceInfo`のみが含まれます
- Rule 2では`ListThingGroupsForThing`を使用するため`deviceGroups`のみが含まれます
- 1つのルールで両方のAPIを同時に呼び出すことはできません（AWS IoT Coreの制限）

## トラブルシューティング

### メッセージが送信できない

1. **証明書の確認**

```bash
ls -la src/client/certs/
# 3つのファイルが存在することを確認
```

2. **証明書のアタッチ状態確認**

```bash
aws iot list-thing-principals --thing-name test-device-001
aws iot list-attached-policies --target <証明書ARN>
```

3. **IoT Policyの確認**

```bash
aws iot get-policy --policy-name test-device-001-policy
```

### Lambda が実行されない

1. **IoT Ruleの状態確認**

```bash
aws iot get-topic-rule --rule-name DescribeThingRule
aws iot get-topic-rule --rule-name ListThingGroupsForThingRule
```

2. **CloudWatch Logsでエラー確認**

```bash
# IoT Ruleのエラーログ
aws logs tail /aws/iot/rules/DescribeThingRule --follow
aws logs tail /aws/iot/rules/ListThingGroupsForThingRule --follow
```

### デバイス情報が取得できない

1. **Thingの属性確認**

```bash
aws iot describe-thing --thing-name test-device-001
```

2. **Thingグループへの追加確認**

```bash
aws iot list-thing-groups-for-thing --thing-name test-device-001
```

3. **IAMロールの権限確認**

```bash
# DescribeThing API用ロール
aws iam get-role --role-name DescribeThingRole
aws iam list-attached-role-policies --role-name DescribeThingRole
aws iam list-role-policies --role-name DescribeThingRole

# ListThingGroupsForThing API用ロール
aws iam get-role --role-name ListThingGroupsForThingRole
aws iam list-role-policies --role-name ListThingGroupsForThingRole
```

### get_registry_data()のエラー

1. **"Rule cannot contain more than 1 get_registry_data function calls"**

   - **原因**: 1つのIoT Ruleで`get_registry_data()`を2回以上呼び出している
   - **対処**: 1つのルールでは1回のみ使用。複数の情報が必要な場合は複数のルールを作成

2. **"Get registry data requires its last parameter to be roleArn"**

   - **原因**: API名構文（`"DescribeThing"`, `"ListThingGroupsForThing"`）でroleArnを省略している
   - **対処**: 必ずroleArnパラメータを指定する

## 実装時の重要な発見

### Lambda呼び出し権限の設定

CDKで`CfnTopicRule`を使用する場合、Lambda関数への権限付与には注意が必要です。

**正しい実装方法**:

```typescript
// Lambda関数に対して、IoTサービスからの呼び出しを許可
logEventFunction.addPermission('IoTInvokePermission', {
  principal: new iam.ServicePrincipal('iot.amazonaws.com'),
  action: 'lambda:InvokeFunction',
  sourceArn: `arn:aws:iot:${this.region}:${this.account}:rule/*`,
});
```

**動作しない方法**:

```typescript
// ❌ これだけではCfnTopicRuleからの呼び出しに対応できない
const iotRuleRole = new iam.Role(this, 'IoTRuleRole', {
  assumedBy: new iam.ServicePrincipal('iot.amazonaws.com'),
});
logEventFunction.grantInvoke(iotRuleRole);
```

**エラーメッセージ**:
```
iot.amazonaws.com is unable to perform: lambda:InvokeFunction on resource: arn:aws:lambda:...:function:xxx
```

### Thing名の指定方法

`get_registry_data()`の第2パラメータには、実際のThing名を指定する必要があります。

**正しい実装**:

```typescript
// CDKスタック内で定義したThing名を使用
const thingName = 'test-device-001';

sql: `
  SELECT
    get_registry_data("DescribeThing", '${thingName}', '${roleArn}') as deviceInfo
  FROM
    'device/+/telemetry'
`
```

**注意が必要なケース**:

```sql
-- ❌ clientIdはMQTT接続のクライアントIDであり、Thing名とは限らない
get_registry_data("DescribeThing", clientId, roleArn)

-- ✅ Thing名を明示的に指定するか、トピックから抽出
get_registry_data("DescribeThing", 'test-device-001', roleArn)
-- または
get_registry_data("DescribeThing", topic(2), roleArn)  -- device/THING_NAME/telemetry の場合
```

### roleArnの必須性

API名構文を使用する場合、AWSドキュメントでは`[roleArn]`と角括弧で記載されていますが、**実際にはroleArnは必須パラメータ**です。

**検証結果**:

```sql
-- ❌ エラー: "Get registry data requires its last parameter to be roleArn"
get_registry_data("DescribeThing", thingName)

-- ✅ 正常動作
get_registry_data("DescribeThing", thingName, 'arn:aws:iam::xxx:role/RoleName')
```

### 1ルール1呼び出しの制限

1つのIoT Ruleで`get_registry_data()`は**1回のみ**呼び出し可能です。

**エラーになる例**:

```sql
-- ❌ エラー: "Rule cannot contain more than 1 get_registry_data function calls"
SELECT
  get_registry_data("DescribeThing", thingName, roleArn) as deviceInfo,
  get_registry_data("ListThingGroupsForThing", thingName, roleArn) as deviceGroups
FROM 'device/+/telemetry'
```

**解決策**:

複数の情報が必要な場合は、以下のいずれかの方法を使用します:

1. **複数のIoT Ruleを作成** (このサンプルで採用)
   - Rule 1: `DescribeThing`でThing情報を取得
   - Rule 2: `ListThingGroupsForThing`でThingグループを取得

2. **属性パス構文を使用** (roleArnは省略可能)
   ```sql
   SELECT
     get_registry_data('attributes', thingName) as attributes,
     get_registry_data('thingGroups', thingName) as thingGroups
   FROM 'device/+/telemetry'
   ```
   ただし、この場合は取得できる情報が限定されます。

### IoT Rule実行ログの確認

IoT Ruleの動作をデバッグするには、CloudWatch LogsのIoTログを確認します:

```bash
# IoT Coreのロギング設定を確認
aws iot get-v2-logging-options

# IoT Ruleのログを確認
aws logs tail AWSIotLogsV2 --follow --filter-pattern "RuleName"
```

**ログの見方**:

- `"eventType":"RuleMatch"` - ルールがメッセージにマッチした
- `"eventType":"RuleExecution"` - ルールのアクションが実行された
- `"status":"Success"` - 成功
- `"status":"Failure"` - 失敗（`details`フィールドにエラー詳細）

## クリーンアップ

### 1. 証明書のデタッチと削除

```bash
# 証明書ARNを取得
CERT_ARN=$(aws iot list-thing-principals --thing-name test-device-001 --query 'principals[0]' --output text)

# ポリシーをデタッチ
aws iot detach-policy --policy-name test-device-001-policy --target $CERT_ARN

# Thingからデタッチ
aws iot detach-thing-principal --thing-name test-device-001 --principal $CERT_ARN

# 証明書を非アクティブ化
CERT_ID=$(echo $CERT_ARN | cut -d'/' -f2)
aws iot update-certificate --certificate-id $CERT_ID --new-status INACTIVE

# 証明書を削除
aws iot delete-certificate --certificate-id $CERT_ID
```

### 2. CDKスタックの削除

```bash
cd src/cdk
cdk destroy
```

### 3. ローカルファイルの削除

```bash
rm -f src/client/certs/*.pem
rm -f src/client/certs/*.key
rm -f certificate-output.json
```

## 応用例

このサンプルを基に、以下のような応用が可能です:

1. **動的な閾値管理**: Thing属性に閾値を設定し、IoTルールで判定（`DescribeThing`使用）
2. **環境別ルーティング**: Thingグループで環境を分け、異なる処理先に振り分け（`ListThingGroupsForThing`使用）
3. **親子関係の活用**: ゲートウェイの設定を子デバイスが参照（`DescribeThing`使用）
4. **マルチテナント**: テナントIDをThingグループで管理（`ListThingGroupsForThing`使用）
5. **クロスアカウントアクセス**: roleArnを活用して別アカウントのThingにアクセス

**注意**: 1つのルールで複数の情報（Thing属性とThingグループ）が必要な場合は、複数のルールを組み合わせるか、属性パス構文（`'attributes'`, `'thingGroups'`）の使用を検討してください。

詳細は[../docs/ideas.md](../docs/ideas.md)を参照してください。

## 参考リンク

- [AWS IoT Core Developer Guide](https://docs.aws.amazon.com/iot/latest/developerguide/)
- [AWS IoT Rules](https://docs.aws.amazon.com/iot/latest/developerguide/iot-rules.html)
- [get_registry_data() Function](https://docs.aws.amazon.com/iot/latest/developerguide/iot-sql-functions.html#iot-sql-function-get-registry-data)
- [Thing Registry](https://docs.aws.amazon.com/iot/latest/developerguide/thing-registry.html)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)

## ライセンス

MIT License
