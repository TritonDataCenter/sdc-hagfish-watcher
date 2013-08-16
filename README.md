# Hagfish Watcher

Repository: <git@git.joyent.com:hagfish-watcher.git>
Browsing: <https://mo.joyent.com/hagfish-watcher>
Who: Orlando Vazquez
Docs: <https://mo.joyent.com/docs/hagfish-watcher>
Tickets/bugs: <https://devhub.joyent.com/jira/browse/AGENT>

## Synopsis

Hagfish is the Smart Data Center service for recording VM usage data and
storing it in Manta. It consists of an agent running on the compute node,
writing streaming data into a log file and processes which consume this data
and upload it to Manta (TBD)


## Overview

The hagfish service resides on SDC compute nodes. It is responsible for
producing periodic updates on the state of all vms on a system. This data is
then removed from the local machine and copied to Manta for querying and reporting.


# Repository

    deps/           Git submodules and/or commited 3rd-party deps should go
                    here. See "node_modules/" for node.js deps.
    docs/           Project docs (restdown)
    lib/            Source files.
    node_modules/   Node.js deps, either populated at build time or commited.
                    See Managing Dependencies.
    pkg/            Package lifecycle scripts
    smf/manifests   SMF manifests
    smf/methods     SMF method scripts
    test/           Test suite (using node-tap)
    tools/          Miscellaneous dev/upgrade/deployment tools and data.
    Makefile
    package.json    npm module info (holds the project version)
    README.md


# Development

To run the provisioner agent:

    git clone git@git.joyent.com:provisioner.git
    cd provisioner
    git submodule update --init
    make all
    node server.js


# Documentation

To update the documentation, edit "docs/index.restdown" and run `make docs`
to update "docs/index.html".

Before commiting/pushing run `make prepush` and, if possible, get a code
review.


# Design

(See docs/index.restdown for more in-depth details)


# Testing

    make test

If you project has setup steps necessary for testing, then describe those
here.
