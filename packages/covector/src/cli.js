const { spawn, timeout } = require("effection");
const { ChildProcess } = require("@effection/node");
const { once, throwOnErrorEvent } = require("@effection/events");
const yargs = require("yargs");
const { configFile, changeFiles } = require("@covector/files");
const { assemble } = require("@covector/assemble");

function raceTime(
  t = 10000,
  msg = `timeout out waiting ${t / 1000}s for command`
) {
  return spawn(function* () {
    yield timeout(t);
    throw new Error(msg);
  });
}

module.exports.cli = function* (argv) {
  const cwd = process.cwd();
  const config = yield configFile({ cwd });
  const options = parseOptions(config, argv);
  const changesArray = yield changeFiles({ cwd });
  const assembledChanges = assemble(changesArray);

  if (options.command === "status") {
    if (changesArray.length === 0) {
      console.info("There are no changes.");
    } else {
      console.log("changes:");
      return Object.keys(assembledChanges.releases).forEach((release) => {
        console.log(`${release} => ${assembledChanges.releases[release].type}`);
        console.dir(assembledChanges.releases[release].changes);
      });
    }
  } else if (options.command === "config") {
    delete config.vfile;
    return console.dir(config);
  } else if (options.command === "version") {
    // run mergeConfig with values via template function
    // create the changelog

    yield raceTime();
    let child = yield ChildProcess.spawn("ls", [], {
      shell: process.env.shell,
      stdio: "inherit",
      windowsHide: true,
    });

    yield throwOnErrorEvent(child);
    return yield once(child, "exit");
  } else if (options.command === "publish") {
    // run mergeConfig with values via template function
    // create the changelog
    // spawnCommand
    return;
  }
};

function parseOptions(config, argv) {
  let rawOptions = yargs({})
    .scriptName("covector")
    .command("status", "run status command")
    .command("config", "output current config")
    .command("version", "run version command")
    .command("publish", "run publish command")
    .demandCommand(1)
    .help()
    .parse(argv);

  return { command: rawOptions._[0] };
}