## gren-make-static

Use this program to convert Gren applications into static executables.

The Gren application has to target the node platform, be compiled to a file without the .js extension and cannot make use of ports.

Usage:

    gren-make-static <input-file> <executable>

You can also generate a snapshot, which can be passed to node.js to improve startup time:

    gren-make-static --snapshot <input-file> <snapshot-file>
