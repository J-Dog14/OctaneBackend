/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep large server-only packages out of the webpack bundle.
  // This reduces worker startup parse time significantly.
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
};

module.exports = nextConfig;

