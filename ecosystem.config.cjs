const nodeInterpreter = process.env.BERI_SEGODNYA_NODE || "/opt/beri-segodnya/node-v24.19.0-linux-x64/bin/node";
const appCwd = process.env.BERI_SEGODNYA_CWD || "/var/www/beri-segodnya";

module.exports = {
  apps: [
    {
      name: "beri-segodnya",
      script: "./server.mjs",
      cwd: appCwd,
      interpreter: nodeInterpreter,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      kill_timeout: 5_000,
      listen_timeout: 10_000
    }
  ]
};
