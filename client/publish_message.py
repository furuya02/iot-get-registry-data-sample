#!/usr/bin/env python3
"""
AWS IoT Core MQTTクライアント

get_registry_data()機能をテストするため、デバイスからメッセージを送信します。
"""

import json
import time
import argparse
from pathlib import Path
from AWSIoTPythonSDK.MQTTLib import AWSIoTMQTTClient


def publish_telemetry(
    endpoint: str,
    thing_name: str,
    cert_path: str,
    key_path: str,
    root_ca_path: str,
    topic: str,
    message_count: int = 2,
    interval: int = 2,
) -> None:
    """
    IoT Coreにテレメトリーデータを送信

    Args:
        endpoint: IoT Core MQTTエンドポイント
        thing_name: Thing名（クライアントID）
        cert_path: デバイス証明書のパス
        key_path: 秘密鍵のパス
        root_ca_path: ルートCA証明書のパス
        topic: 送信先MQTTトピック
        message_count: 送信するメッセージ数
        interval: メッセージ送信間隔（秒）
    """
    # MQTTクライアントの初期化
    mqtt_client = AWSIoTMQTTClient(thing_name)
    mqtt_client.configureEndpoint(endpoint, 8883)
    mqtt_client.configureCredentials(root_ca_path, key_path, cert_path)

    # 接続設定
    mqtt_client.configureAutoReconnectBackoffTime(1, 32, 20)
    mqtt_client.configureOfflinePublishQueueing(-1)
    mqtt_client.configureDrainingFrequency(2)
    mqtt_client.configureConnectDisconnectTimeout(10)
    mqtt_client.configureMQTTOperationTimeout(5)

    print(f"Connecting to {endpoint}...")
    mqtt_client.connect()
    print("Connected successfully!")

    try:
        for i in range(message_count):
            # テレメトリーデータ
            message = {
                "timestamp": int(time.time() * 1000),
            }

            message_json = json.dumps(message, ensure_ascii=False)
            print(f"\nPublishing message {i + 1}/{message_count}:")
            print(f"  Topic: {topic}")
            print(f"  Payload: {message_json}")

            mqtt_client.publish(topic, message_json, 1)
            print("  Status: Published successfully")

            if i < message_count - 1:
                time.sleep(interval)

    finally:
        print("\nDisconnecting...")
        mqtt_client.disconnect()
        print("Disconnected")


def main() -> None:
    """メイン関数"""
    parser = argparse.ArgumentParser(
        description="Publish telemetry data to AWS IoT Core"
    )
    parser.add_argument("--endpoint", required=True, help="IoT Core MQTT endpoint")
    parser.add_argument(
        "--thing-name",
        default="test-device-001",
        help="Thing name (default: test-device-001)",
    )
    parser.add_argument(
        "--cert",
        default="certs/device.cert.pem",
        help="Path to device certificate (default: certs/device.cert.pem)",
    )
    parser.add_argument(
        "--key",
        default="certs/device.private.key",
        help="Path to private key (default: certs/device.private.key)",
    )
    parser.add_argument(
        "--root-ca",
        default="certs/AmazonRootCA1.pem",
        help="Path to root CA certificate (default: certs/AmazonRootCA1.pem)",
    )
    parser.add_argument(
        "--topic",
        help="MQTT topic (default: device/<thing-name>/telemetry)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=5,
        help="Number of messages to send (default: 5)",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=2,
        help="Interval between messages in seconds (default: 2)",
    )

    args = parser.parse_args()

    # デフォルトトピックの設定
    topic = args.topic or f"device/{args.thing_name}/telemetry"

    # ファイル存在チェック
    cert_path = Path(args.cert)
    key_path = Path(args.key)
    root_ca_path = Path(args.root_ca)

    if not cert_path.exists():
        print(f"Error: Certificate file not found: {cert_path}")
        print("Please run the certificate creation steps first (see README.md)")
        return

    if not key_path.exists():
        print(f"Error: Private key file not found: {key_path}")
        print("Please run the certificate creation steps first (see README.md)")
        return

    if not root_ca_path.exists():
        print(f"Error: Root CA file not found: {root_ca_path}")
        print("Please download AmazonRootCA1.pem (see README.md)")
        return

    # メッセージ送信
    publish_telemetry(
        endpoint=args.endpoint,
        thing_name=args.thing_name,
        cert_path=str(cert_path),
        key_path=str(key_path),
        root_ca_path=str(root_ca_path),
        topic=topic,
        message_count=args.count,
        interval=args.interval,
    )


if __name__ == "__main__":
    main()
