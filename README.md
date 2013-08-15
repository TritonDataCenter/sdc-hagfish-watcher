# Hagfish

## Synopsis

Hagfish is the Smart Data Center service for recording VM usage data and
storing it in Manta.


## Overview

The hagfish service resides on SDC compute nodes. It is responsible for
producing periodic updates on the state of all vms on a system. This data is
then copied to Manta, and removed from the local machine.


## Watcher

Every minute the "watcher" will look at all VMs on the server. It will grab
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
