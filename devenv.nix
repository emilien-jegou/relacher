{ pkgs, ... }:

{
  packages = [
    pkgs.bun
    pkgs.git-cliff
    pkgs.gh
  ];

  languages.javascript = {
    enable = true;
  };

  enterShell = ''
    [ -f .localrc ] && source .localrc
  '';

  dotenv.enable = true;
}
