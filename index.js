#!/usr/bin/env node

const fs = require("fs/promises");
const cp = require("child_process");
const postject = require("postject");

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";

const nodePath = process.execPath;
const args = process.argv.slice(2);
const cliOpts = args.filter((arg) => arg.startsWith("-"));
const cliArgs = args.filter((arg) => !arg.startsWith("-"));

if (cliOpts.includes("-h") || cliOpts.includes("--help")) {
  printHelp();
} else if (cliArgs.length !== 2) {
  printHelp();
} else if (cliOpts.includes("-s") || cliOpts.includes("--snapshot")) {
  makeSnapshot(cliArgs[0], cliArgs[1]);
} else {
  makeExecutable(cliArgs[0], cliArgs[1]);
}

function printHelp() {
  console.log(`gren-make-static

Use this program to convert Gren applications into static executables.

The Gren application has to target the node platform, be compiled to a file without the .js extension and cannot make use of ports.

Usage:

    gren-make-static <input-file> <executable>

You can also generate a snapshot, which can be passed to node.js to improve startup time:

    gren-make-static --snapshot <input-file> <snapshot-file>
`);
}

async function makeSnapshot(input, output) {
  const jsBuildPath = input + ".tmp";

  try {
    await makeSnapshotCompatible(input, jsBuildPath);

    // Generate the snapshot
    cp.execFileSync(nodePath, [
      "--snapshot-blob",
      output,
      "--build-snapshot",
      jsBuildPath,
    ]);

    console.log("Done!");
  } catch (e) {
    console.error("Failed to create snapshot", e);
  } finally {
    // cleanup
    await fs.rm(jsBuildPath);
  }
}

// For snapshots to work we need to wrap the function call that starts
// the Gren application, with a hint that tells the V8 engine what the
// main function is
async function makeSnapshotCompatible(input, target) {
  const compiledSrc = await fs.readFile(input, "utf-8");

  const initRegex = /this\.Gren\..+\(\{\}\);/g;
  const initCall = compiledSrc.match(initRegex)[0];

  const snapshotCompatibleSrc = compiledSrc.replace(
    initCall,
    `
  const v8 = require('node:v8');
  v8.startupSnapshot.setDeserializeMainFunction(function() {
    ${initCall}
  });
  `,
  );

  await fs.writeFile(target, snapshotCompatibleSrc);
}

async function makeExecutable(input, target) {
  const jsBuildPath = input + ".tmp";
  const blobPath = input + ".tmp.blob";

  const seaConfigPath = input + ".sea.config";
  const seaConfig = {
    main: jsBuildPath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: true,
  };

  const binPath = isWin && !target.endsWith(".exe") ? target + ".exe" : target;

  try {
    await makeSnapshotCompatible(input, jsBuildPath);

    // Generate the snapshot
    await fs.writeFile(seaConfigPath, JSON.stringify(seaConfig));
    cp.execFileSync(nodePath, ["--experimental-sea-config", seaConfigPath]);

    // Then copy the node executable and inject the snapshot into it
    await fs.copyFile(nodePath, binPath);
    await fs.chmod(binPath, "755");

    if (isMac) {
      // required on mac, optional on windows, not required on linux
      cp.execFileSync("codesign", ["--remove-signature", binPath]);
    }

    const blobContent = await fs.readFile(blobPath);

    await postject.inject(binPath, "NODE_SEA_BLOB", blobContent, {
      sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
      machoSegmentName: isMac ? "NODE_SEA" : undefined,
    });

    if (isMac) {
      // required on mac
      cp.execFileSync("codesign", ["--sign", "-", binPath]);
    }

    console.log("Done!");
  } catch (e) {
    console.error("Failed to create static executable", e);
    await fs.rm(binPath);
  } finally {
    // cleanup
    await fs.rm(jsBuildPath);
    await fs.rm(seaConfigPath);
    await fs.rm(blobPath);
  }
}
