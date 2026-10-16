import { puppeteerLauncher } from '@web/test-runner-puppeteer';

export default {
  files: 'test/specs/**/*.spec.js',
  nodeResolve: true,
  coverage: true,
  coverageConfig: {
    include: ['src/**/*.js'],
    report: true,
    reportDir: 'coverage',
  },
  browsers: [
    puppeteerLauncher({
      launchOptions: {
        args: ['--no-sandbox'],
      },
    }),
  ],
  testFramework: {
    config: {
      timeout: 10000,
    },
  },
  testRunnerHtml: (testFramework) => `<!doctype html>
<html>
  <body>
    <script type="module" src="/test/setup.js"></script>
    <script type="module" src="/test/helpers.js"></script>
    <script type="module" src="${testFramework}"></script>
  </body>
</html>`,
};
