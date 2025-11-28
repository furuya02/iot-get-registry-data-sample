import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event: dict, context: dict) -> dict:
    """
    IoT Ruleから送信されたイベントをCloudWatch Logsに出力するLambda関数

    get_registry_data()で取得したデバイス情報を含むイベント全体をログに記録します。
    IoT RuleのSQL内のrule_typeフィールドでどちらのルールから呼び出されたか識別します。
    """
    # IoT RuleのSQLで設定されたrule_typeを取得（環境変数は使用しない）
    rule_type = event.get("rule_type", "UNKNOWN")
    logger.info(f"========== {rule_type} ==========")
    logger.info(json.dumps(event, indent=2, ensure_ascii=False))
