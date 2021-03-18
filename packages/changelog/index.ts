import {
  readChangelog,
  writeChangelog,
  ConfigFile,
  Pkg,
  ChangelogFile,
} from "@covector/files";
import path from "path";
import unified from "unified";
import parse from "remark-parse";
import stringify from "remark-stringify";

type PkgCommandResponse = {
  precommand: string | boolean;
  command: string | boolean;
  postcommand: string | boolean;
  pkg: Pkg;
};

type Meta = {
  dependencies: { [k: string]: string }[];
  commits?: {
    filename: string;
    hashShort: string;
    hashLong: string;
    date: string;
    commitSubject: string;
  }[];
};

type AssembledChanges = {
  releases: {
    [k: string]: {
      changes: {
        summary: string;
        meta?: Meta;
      }[];
    };
  };
  summary: string;
  meta?: Meta;
};

export const fillChangelogs = async ({
  applied,
  assembledChanges,
  config,
  cwd,
  pkgCommandsRan,
  create = true,
}: {
  applied: { name: string; version: string }[];
  assembledChanges: AssembledChanges;
  config: ConfigFile;
  cwd: string;
  pkgCommandsRan?: { [k: string]: PkgCommandResponse };
  create?: boolean;
}) => {
  const changelogs = await readAllChangelogs({
    applied: applied.reduce(
      (
        final: { name: string; version: string; changelog?: ChangelogFile }[],
        current
      ) =>
        !config.packages[current.name].path ? final : final.concat([current]),
      []
    ),
    packages: config.packages,
    cwd,
  });

  const writtenChanges = applyChanges({
    changelogs,
    assembledChanges,
    config,
  });

  if (create) {
    await writeAllChangelogs({ writtenChanges });
  }

  if (!pkgCommandsRan) {
    return;
  } else {
    pkgCommandsRan = Object.keys(pkgCommandsRan).reduce(
      (pkgs: { [k: string]: PkgCommandResponse }, pkg) => {
        writtenChanges.forEach((change) => {
          if (change.pkg === pkg) {
            pkgs[pkg].command = change.addition;
          }
        });
        return pkgs;
      },
      pkgCommandsRan
    );

    return pkgCommandsRan;
  }
};

const readAllChangelogs = ({
  applied,
  packages,
  cwd,
}: {
  applied: { name: string; version: string }[];
  packages: ConfigFile["packages"];
  cwd: string;
}) => {
  return Promise.all(
    applied.map((change) =>
      readChangelog({
        //@ts-ignore
        cwd: path.join(cwd, packages[change.name].path),
      })
    )
  ).then((changelogs) =>
    changelogs.map((changelog, index) => ({
      changes: applied[index],
      changelog,
    }))
  );
};

const applyChanges = ({
  changelogs,
  assembledChanges,
  config,
}: {
  changelogs: {
    changes: { name: string; version: string };
    changelog?: ChangelogFile;
  }[];
  assembledChanges: AssembledChanges;
  config: ConfigFile;
}) => {
  const gitSiteUrl = !config.gitSiteUrl
    ? "/"
    : config.gitSiteUrl.replace(/\/$/, "") + "/";

  const processor: any = unified().use(parse).use(stringify, {
    bullet: "-",
    listItemIndent: "one",
  });

  return changelogs.map((change) => {
    let addition = "";
    if (change.changelog) {
      let changelog = processor.parse(change.changelog.contents);
      if (!assembledChanges.releases[change.changes.name]) {
        addition = `## [${change.changes.version}]\nBumped due to dependency.`;
      } else {
        addition = assembledChanges.releases[
          change.changes.name
        ].changes.reduce(
          (finalString, release) =>
            !release.meta || (!!release.meta && !release.meta.commits)
              ? `${finalString}\n- ${release.summary}`
              : `${finalString}\n- ${release.summary}\n${
                  !release.meta.dependencies
                    ? ""
                    : `  - ${release.meta.dependencies}\n`
                }${release.meta
                  .commits!.map(
                    (commit) =>
                      `  - [${commit.hashShort}](${gitSiteUrl}commit/${
                        commit.hashLong
                      }) ${commit.commitSubject.replace(
                        /(#[0-9]+)/g,
                        (match) =>
                          `[${match}](${gitSiteUrl}pull/${match.substr(
                            1,
                            999999
                          )})`
                      )} on ${commit.date}`
                  )
                  .join("\n")}`,
          `## [${change.changes.version}]`
        );
      }
      const parsedAddition = processor.parse(addition);
      const changelogFirstElement = changelog.children.shift();
      const changelogRemainingElements = changelog.children;
      changelog.children = [].concat(
        changelogFirstElement,
        parsedAddition.children,
        changelogRemainingElements
      );
      change.changelog.contents = processor.stringify(changelog);
    }
    return { pkg: change.changes.name, change, addition };
  });
};

const writeAllChangelogs = ({
  writtenChanges,
}: {
  writtenChanges: {
    pkg: string;
    change: {
      changes: {
        name: string;
        version: string;
      };
      changelog?: ChangelogFile;
    };
    addition: string;
  }[];
}) => {
  return Promise.all(
    writtenChanges.map((changes) => {
      const { changelog } = changes.change;
      if (changelog) {
        return writeChangelog({ changelog });
      } else {
        throw new Error(`Changelog not properly created: ${changes}`);
      }
    })
  );
};