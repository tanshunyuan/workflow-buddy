import { mergeConfig, defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
      environmentOptions: {
        jsdom: {
          url: "https://example.com/"
        }
      }
    }
  })
);
