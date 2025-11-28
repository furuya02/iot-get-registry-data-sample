#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { IotRegistryDataSampleStack } from '../lib/iot-registry-data-sample-stack';

const app = new cdk.App();
new IotRegistryDataSampleStack(app, 'IotRegistryDataSampleStack', {
  description: 'AWS IoT Core get_registry_data() sample implementation',
});
