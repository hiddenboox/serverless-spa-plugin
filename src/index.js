'use strict'

import { spawnSync } from 'child_process'

export default class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.commands = {
      syncToS3: {
        usage: 'Deploys the `app` directory to your bucket',
        lifecycleEvents: ['sync'],
      },
      bucketInfo: {
        usage: 'Fetches and prints out the deployed CloudFront bucket names',
        lifecycleEvents: ['bucketInfo'],
      },
      domainInfo: {
        usage: 'Fetches and prints out the deployed CloudFront domain names',
        lifecycleEvents: ['domainInfo'],
      },
      invalidateCloudFrontCache: {
        usage: 'Invalidates CloudFront cache',
        lifecycleEvents: ['invalidateCache'],
      },
    }

    this.hooks = {
      'syncToS3:sync': this.syncDirectory,
      'domainInfo:domainInfo': this.domainInfo,
      'bucketInfo:bucketInfo': this.bucketInfo,
      'invalidateCloudFrontCache:invalidateCache': this.invalidateCache,
    }
  }

  invalidateCache = async () => {
    const provider = this.serverless.getProvider('aws')

    const domain = await this.domainInfo()

    const result = await provider.request(
      'CloudFront',
      'listDistributions',
      {},
      this.options.stage,
      this.options.region,
    )

    const distributions = result.DistributionList.Items
    const distribution = distributions.find(
      entry => entry.DomainName === domain,
    )

    if (distribution) {
      this.serverless.cli.log(
        `Invalidating CloudFront distribution with id: ${distribution.Id}`,
      )
      const args = [
        'cloudfront',
        'create-invalidation',
        '--distribution-id',
        distribution.Id,
        '--paths',
        '/*',
      ]
      const { sterr } = this.runAwsCommand(args)
      if (!sterr) {
        this.serverless.cli.log('Successfully invalidated CloudFront cache')
      } else {
        throw new Error('Failed invalidating CloudFront cache')
      }
    } else {
      const message = `Could not find distribution with domain ${domain}`
      const error = new Error(message)
      this.serverless.cli.log(message)
      throw error
    }
  }

  runAwsCommand(args) {
    let command = 'aws'
    if (this.serverless.variables.service.provider.region) {
      command = `${command} --region ${this.serverless.variables.service.provider.region}`
    }
    if (this.serverless.variables.service.provider.profile) {
      command = `${command} --profile ${this.serverless.variables.service.provider.profile}`
    }
    const { stdout, sterr } = spawnSync(command, args)
    if (stdout) {
      this.serverless.cli.log(stdout.toString())
    }
    if (sterr) {
      this.serverless.cli.log(sterr.toString())
    }

    return { stdout, sterr }
  }

  getDescribeStacksOutput(outputKey) {
    const provider = this.serverless.getProvider('aws')
    const stackName = provider.naming.getStackName(this.options.stage)
    return provider
      .request(
        'CloudFormation',
        'describeStacks',
        { StackName: stackName },
        this.options.stage,
        this.options.region, // eslint-disable-line comma-dangle
      )
      .then(result => {
        const outputs = result.Stacks[0].Outputs
        const output = outputs.find(entry => entry.OutputKey === outputKey)
        return output.OutputValue
      })
  }

  // syncs the `app` directory to the provided bucket
  syncDirectory = () => {
    this.getDescribeStacksOutput('WebAppS3BucketOutput').then(s3Bucket => {
      const s3LocalPath = this.serverless.variables.service.custom.s3LocalPath
      const args = ['s3', 'sync', s3LocalPath, `s3://${s3Bucket}/`]
      this.serverless.cli.log(args)
      const result = spawnSync('aws', args)
      const stdout = result && result.stdout && result.stdout.toString()
      const sterr = result && result.stderr && result.stderr.toString()
      this.serverless.cli.log(stdout || 'stdoud undefined')
      this.serverless.cli.log(sterr || 'stderr undefined')
      if (!sterr) {
        this.serverless.cli.log('Successfully synced to the S3 bucket')
      }
    })
  }

  // fetches the bucket name from the CloudFront outputs and prints it out
  bucketInfo = () => {
    this.getDescribeStacksOutput('WebAppS3BucketOutput').then(outputValue =>
      this.serverless.cli.log(`Web App Bucket: ${outputValue || 'Not Found'}`),
    )
  }

  // fetches the domain name from the CloudFront outputs and prints it out
  domainInfo = async () => {
    const provider = this.serverless.getProvider('aws')
    const stackName = provider.naming.getStackName(this.options.stage)
    const result = await provider.request(
      'CloudFormation',
      'describeStacks',
      { StackName: stackName },
      this.options.stage,
      this.options.region,
    )

    const outputs = result.Stacks[0].Outputs
    const output = outputs.find(
      entry => entry.OutputKey === 'WebAppCloudFrontDistributionOutput',
    )

    if (output && output.OutputValue) {
      this.serverless.cli.log(`Web App Domain: ${output.OutputValue}`)
      return output.OutputValue
    }

    this.serverless.cli.log('Web App Domain: Not Found')
    const error = new Error('Could not extract Web App Domain')
    throw error
  }
}
