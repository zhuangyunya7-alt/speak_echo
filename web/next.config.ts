import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "speakecho-1405309880.cos.ap-shanghai.myqcloud.com" },
    ],
  },
};

export default nextConfig;
