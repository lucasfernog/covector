import { spawn, timeout } from "effection";
import { exec } from "@effection/process";
import execa from "execa";
import path from "path";

import type {
  PkgVersion,
  PkgPublish,
  RunningCommand,
  NormalizedCommand,
} from "@covector/types";

export const attemptCommands = function* ({
  cwd,
  commands,
  command,
  commandPrefix = "",
  pkgCommandsRan,
  dryRun,
}: {
  cwd: string;
  commands: (PkgVersion | PkgPublish)[];
  command: string; // the covector command that was ran
  commandPrefix?: string;
  pkgCommandsRan?: object;
  dryRun: boolean;
}): Generator<any, { [k: string]: { [c: string]: string | boolean } }, string> {
  let _pkgCommandsRan: { [k: string]: { [c: string]: string | boolean } } = {
    ...pkgCommandsRan,
  };
  for (let pkg of commands) {
    const initialStdout =
      pkgCommandsRan &&
      //@ts-ignore
      pkgCommandsRan[pkg.pkg] &&
      //@ts-ignore
      pkgCommandsRan[pkg.pkg][`${commandPrefix}command`] &&
      //@ts-ignore
      typeof pkgCommandsRan[pkg.pkg][`${commandPrefix}command`] === "string"
        ? //@ts-ignore
          pkgCommandsRan[pkg.pkg][`${commandPrefix}command`]
        : false;
    //@ts-ignore template literals issues
    if (!pkg[`${commandPrefix}command`]) continue;
    //@ts-ignore template literals issues
    const c: string | Function | [] = pkg[`${commandPrefix}command`];
    const pubCommands: (NormalizedCommand | string | Function)[] =
      typeof c === "string" || typeof c === "function" || !Array.isArray(c)
        ? [c]
        : c;
    let stdout = initialStdout ? `${initialStdout}\n` : "";
    for (let pubCommand of pubCommands) {
      const runningCommand: RunningCommand = {
        ...(typeof pubCommand === "object"
          ? { runFromRoot: pubCommand.runFromRoot }
          : {}),
      };
      if (
        typeof pubCommand === "object" &&
        pubCommand.dryRunCommand === false
      ) {
        runningCommand.command = pubCommand.command;
        runningCommand.shouldRunCommand = !dryRun;
      } else if (typeof pubCommand === "object") {
        // dryRunCommand will either be a !string (false) or !undefined (true) or !true (false)
        if (pubCommand.dryRunCommand === true) {
          runningCommand.command = pubCommand.command;
          runningCommand.shouldRunCommand = true;
        } else if (typeof pubCommand.dryRunCommand === "string" && dryRun) {
          runningCommand.command = pubCommand.dryRunCommand;
          runningCommand.shouldRunCommand = true;
        } else {
          runningCommand.command = pubCommand.command;
          runningCommand.shouldRunCommand = !dryRun;
        }
      } else {
        runningCommand.command = pubCommand;
        runningCommand.shouldRunCommand = !dryRun;
      }

      if (runningCommand.shouldRunCommand && runningCommand.command) {
        if (typeof runningCommand.command === "function") {
          try {
            const pipeToFunction = {
              ...pkg,
              pkgCommandsRan: {
                ..._pkgCommandsRan[pkg.pkg],
                [`${commandPrefix}command`]: stdout,
              },
            };
            yield runningCommand.command(pipeToFunction);

            if (typeof pubCommand === "object" && pubCommand.pipe) {
              console.warn(`We cannot pipe the function command in ${pkg.pkg}`);
            }
          } catch (e) {
            console.error(e);
          }
        } else {
          const ranCommand = yield runCommand({
            command: runningCommand.command,
            cwd,
            pkg: pkg.pkg,
            pkgPath: runningCommand.runFromRoot === true ? "" : pkg.path || "",
            log: `${pkg.pkg} [${commandPrefix}${command}${
              runningCommand.runFromRoot === true ? " run from the cwd" : ""
            }]: ${runningCommand.command}`,
          });

          if (typeof pubCommand === "object" && pubCommand.pipe) {
            stdout = `${stdout}${ranCommand}\n`;
          }
        }
      } else {
        console.log(
          `dryRun >> ${pkg.pkg} [${commandPrefix}${command}${
            runningCommand.runFromRoot === true ? " run from the cwd" : ""
          }]: ${runningCommand.command}`
        );
      }
    }

    if (!!pkgCommandsRan)
      _pkgCommandsRan[pkg.pkg][`${commandPrefix}command`] =
        stdout !== "" ? stdout : true;

    if (!!pkgCommandsRan && command === "publish" && !commandPrefix)
      _pkgCommandsRan[pkg.pkg]["published"] = true;
  }
  return _pkgCommandsRan;
};

export const confirmCommandsToRun = function* ({
  cwd,
  commands,
  command,
}: {
  cwd: string;
  commands: PkgPublish[];
  command: string;
}): Generator<any, PkgPublish[], any> {
  let subPublishCommand = command.slice(7, 999);
  let commandsToRun: PkgPublish[] = [];
  for (let pkg of commands) {
    //@ts-ignore template literals issues
    const getPublishedVersion = pkg[`getPublishedVersion${subPublishCommand}`];
    if (!!getPublishedVersion) {
      const version = yield runCommand({
        command: getPublishedVersion,
        cwd,
        pkg: pkg.pkg,
        pkgPath: pkg.path || "",
        log: `Checking if ${pkg.pkg}${
          !pkg.pkgFile ? "" : `@${pkg.pkgFile.version}`
        } is already published with: ${getPublishedVersion}`,
      });

      if (pkg.pkgFile && pkg.pkgFile.version === version) {
        console.log(
          `${pkg.pkg}@${pkg.pkgFile.version} is already published. Skipping.`
        );
        // early return if published already
        continue;
      }
    }
    commandsToRun = commandsToRun.concat([pkg]);
  }

  return commandsToRun;
};

export const runCommand = function* ({
  pkg = "package",
  command,
  cwd,
  pkgPath,
  log = `running command for ${pkg}`,
}: {
  pkg?: string;
  command: string;
  cwd: string;
  pkgPath: string;
  log: false | string;
}): Generator<any, string, any> {
  if (log !== false) console.log(log);
  yield raceTime();

  return yield* sh(
    command,
    {
      cwd: path.join(cwd, pkgPath),
      encoding: "utf8",
    },
    log
  );
};

export const sh = function* (
  command: string,
  options: { [k: string]: any },
  log: false | string
): Generator<any, string, any> {
  if (command.includes("|") && !options.shell) {
    try {
      const child = yield execa.command(command, {
        ...options,
        shell: true,
        all: true,
        timeout: 1200000,
      });
      const out = child.stdout;
      if (log !== false) {
        console.log(out);
      }
      return out;
    } catch (error: any) {
      throw new Error(error);
    }
  } else {
    let out = "";
    let child = yield exec(command, options);

    yield spawn(
      child.stdout.forEach((text: String) => {
        out = `${out}${text}`;
        if (log !== false) console.log(text.toString().trim());
      })
    );

    yield spawn(
      child.stderr.forEach((text: String) => {
        out = `${out}${text}`;
        if (log !== false) console.error(text.toString().trim());
      })
    );

    yield child.expect();
    return out.trim();
  }
};

export const raceTime = function* ({
  t = 1200000,
  msg = `timeout out waiting ${t / 1000}s for command`,
}: {
  t?: number;
  msg?: string;
} = {}): Generator<any> {
  try {
    yield spawn(timeout(t));
  } catch (e) {
    throw new Error(msg);
  }
};
