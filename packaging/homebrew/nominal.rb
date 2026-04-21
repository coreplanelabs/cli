# Homebrew formula for the Nominal CLI.
#
# This file belongs in the tap repository (github.com/coreplanelabs/homebrew-nominal)
# at Formula/nominal.rb so users can install via:
#
#   brew install coreplanelabs/nominal
#
# The release pipeline bumps `url` / `sha256` / `version` on every new release —
# see the update-homebrew job in .github/workflows/release.yml.
class Nominal < Formula
  desc "Agent-focused CLI for the Nominal platform"
  homepage "https://nominal.dev"
  # Scoped npm tarball URL. Note the tarball filename after `/-/` uses the
  # unscoped basename (nominal), not the full scoped name.
  url "https://registry.npmjs.org/@coreplane/nominal/-/nominal-0.1.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "nominal", shell_output("#{bin}/nominal --version")
    assert_match "Resources:", shell_output("#{bin}/nominal --help")
  end
end
