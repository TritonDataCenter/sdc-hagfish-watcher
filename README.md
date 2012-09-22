# Hagfish

## Synopsis

Hagfish is the Smart Data Center service for recording VM usage data and
storing it in Manta.


## Overview

The hagfish service resides on SDC compute nodes. It is responsible for
producing periodic updates on the state of all vms on a system. This data is
then copied to Manta, and removed from the local machine.


## Watcher

Ever minute the "watcher" will look at all VMs on the server. It will grab
their attributes from the zone's zonecfg XML file, and zone parameters. NIC usage
statistics from kstat.


## Data

The data to be streamed out to disk out will be oriented around a VM. Each VM
comprising one line of JSON within the file. Each line should be self-contained
and not require any additional information outside of itself. This includes
recording server uuid, datacenter name, owner uuid.

Files should be stored according to this specification:

    /admin/stor/usage/YYYY/MM/DD/HH/:serveruuid.log

The data:

    {
        uuid: <vm-uuid>,
        server_uuid: <server-uuid>,
        max_physical_memory: ...,
        status: 'running',
        image_uuid: <image-uuid>,
        package_uuid: <package-uuid>,
        v: 1
    }

Each VM datum must contain a "v" key which will identify the version of the
given payload. This version can be used to determine what key schema of the
data is.















# Joyent Engineering Guide

Repository: <git@git.joyent.com:eng.git>
Browsing: <https://mo.joyent.com/eng>
Who: Trent Mick, Dave Pacheco
Docs: <https://mo.joyent.com/docs/eng>
Tickets/bugs: <https://devhub.joyent.com/jira/browse/TOOLS>


# Overview

This repo serves two purposes: (1) It defines the guidelines and best
practices for Joyent engineering work (this is the primary goal), and (2) it
also provides boilerplate for an SDC project repo, giving you a starting
point for many of the suggestion practices defined in the guidelines. This is
especially true for node.js-based REST API projects.

Start with the guidelines: <https://mo.joyent.com/docs/eng>


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

To run the boilerplate API server:

    git clone git@git.joyent.com:eng.git
    cd eng
    git submodule update --init
    make all
    node server.js

To update the guidelines, edit "docs/index.restdown" and run `make docs`
to update "docs/index.html".

Before commiting/pushing run `make prepush` and, if possible, get a code
review.



# Testing

    make test

If you project has setup steps necessary for testing, then describe those
here.


# Starting a Repo Based on eng.git

Create a new repo called "some-cool-fish" in your "~/work" dir based on "eng.git":
Note: run this inside the eng dir.

    ./tools/mkrepo $HOME/work/some-cool-fish


# Your Other Sections Here

Add other sections to your README as necessary. E.g. Running a demo, adding
development data.



