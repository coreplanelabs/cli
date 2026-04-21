export function isStdoutTTY(): boolean {
  return Boolean(process.stdout.isTTY);
}

export function isStderrTTY(): boolean {
  return Boolean(process.stderr.isTTY);
}

export function isStdinTTY(): boolean {
  return Boolean(process.stdin.isTTY);
}

export function isCI(): boolean {
  return getCIName() !== null || Boolean(process.env.CI);
}

// Best-effort CI provider detection from well-known env vars. Returns a stable
// short name suitable for analytics, or null when not in CI / unknown CI.
export function getCIName(): string | null {
  const env = process.env;
  if (env.GITHUB_ACTIONS) return 'GitHub Actions';
  if (env.GITLAB_CI) return 'GitLab CI';
  if (env.JENKINS_URL) return 'Jenkins';
  if (env.CIRCLECI) return 'CircleCI';
  if (env.TRAVIS) return 'Travis CI';
  if (env.BUILDKITE) return 'Buildkite';
  if (env.DRONE) return 'Drone';
  if (env.TEAMCITY_VERSION) return 'TeamCity';
  if (env.BITBUCKET_BUILD_NUMBER) return 'Bitbucket Pipelines';
  if (env.APPVEYOR) return 'AppVeyor';
  if (env.CODEBUILD_BUILD_ID) return 'AWS CodeBuild';
  if (env.TF_BUILD) return 'Azure Pipelines';
  if (env.VERCEL) return 'Vercel';
  if (env.NETLIFY) return 'Netlify';
  if (env.CLOUDFLARE_PAGES) return 'Cloudflare Pages';
  if (env.RENDER) return 'Render';
  if (env.RAILWAY_ENVIRONMENT) return 'Railway';
  if (env.FLY_APP_NAME) return 'Fly';
  if (env.CI) return 'Unknown';
  return null;
}

export function isInteractive(nonInteractive: boolean): boolean {
  if (nonInteractive) return false;
  if (isCI()) return false;
  return isStdinTTY() && isStdoutTTY();
}

export function shouldUseColor(noColor: boolean): boolean {
  if (noColor) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return isStdoutTTY();
}
