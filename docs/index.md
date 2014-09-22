---
title: hagfish-watcher
markdown2extras: tables, code-friendly
apisections:
---

# hagfish-watcher

Record customer usage telemetry in SDC.

# Overview

Capture usage data right on the server, buffering it locally first with
periodic uploads to Manta.  Storing the data locally first makes it less likely
to lose important data due to a network or service disruption. In such a
scenario, all the uploader would have to do when service was restored would be
to catch up and upload slightly more usage log files than usual.

# Hagfish-Watcher

The hagfish-watcher service resides on SDC servers.
Every minute the "watcher" will look at all VMs on the server. It will record:

- VM Datacenter information
- Zone configuration values and attributes
- VM network usage
- ZFS disk usage

The watcher is deployed as an agent using the same agent SOPs.


# Data

At startup the watcher will open file for appending.
Each line written to the file will represent a VM's state at that particular
point in time given by the `timestamp` property.  Each line should be
self-contained and not require any additional information outside of itself.
This includes recording, for example, the server uuid, datacenter name, owner
uuid.

Note:

Data is rerturned exactly as it was on the server. The implications of this is
that there may be missing values or values present may not be what you would
expect (reflecting the state of the VM's configuration on the server). For
example, one might expect to encounter VMs with missing image_uuid values,
incorrect pacakge names, etc. Care should also be taken to interpret the values
in the same way and using the same units as the system would. For example,
tmpfs=128 should be interpreted as 128 megabytes.

# Log Rotation

On the compute node, the watcher will log to a file in `/var/log/usage`.  The
filename will contain the date and hour of the telemetry stored in the file,
using the format:

    /var/log/usage/YYYY-MM-DDTHH.log

For example, for the hour of 9PM on the 22nd September 2014, the filename is:

    /var/log/usage/2014-09-22T21.log

At the end of each hour, the agent will compress the log file (using the `gzip`
format).  Once the file is renamed with a `.gz` suffix, it is safe to archive
and remove from the host.  In a SmartDataCenter deployment, this task is
generally performed by the [Hermes](http://github.com/joyent/sdc-hermes.git)
log archival system.


# Sample data

    {
      "zonename": "0f778be3-bd2e-431b-baa0-a1c4ef2100e2",
      "zonepath": "/zones/0f778be3-bd2e-431b-baa0-a1c4ef2100e2",
      "uuid": "0f778be3-bd2e-431b-baa0-a1c4ef2100e2",
      "os_uuid": "0f778be3-bd2e-431b-baa0-a1c4ef2100e2",
      "status": "running",
      "timestamp": "2013-08-15T16:21:29.023Z",
      "config": {
        "name": "0f778be3-bd2e-431b-baa0-a1c4ef2100e2",
        "debugid": "1",
        "zonepath": "/zones/0f778be3-bd2e-431b-baa0-a1c4ef2100e2",
        "autoboot": "true",
        "brand": "joyent-minimal",
        "attributes": {
          "vm-version": "1",
          "create-timestamp": "2013-08-14T16:21:54.021Z",
          "dataset-uuid": "e1d03df6-3aa3-4460-8c02-2777c76b1dd8",
          "billing-id": "73a1ca34-1e30-48c7-8681-70314a9c67d3",
          "owner-uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
          "package-name": "sdc_128",
          "package-version": "1.0.0",
          "tmpfs": "128",
          "dns-domain": "local",
          "resolvers": "10.99.99.11",
          "alias": "assets0"
        },
        "cpu_shares": "128",
        "zfs_io_priority": "10",
        "max_lwps": "1000",
        "max_physical_memory": "134217728",
        "max_locked_memory": "134217728",
        "max_swap": "268435456",
        "cpu_cap": "100",
        "networks": [
          {
            "mac_addr": "32:0a:65:92:cc:7b",
            "vlan_id": "0",
            "physical": "net0",
            "global_nic": "admin",
            "primary": "true",
            "ip": "10.99.99.8",
            "netmask": "255.255.255.0"
          }
        ]
      },
      "network_usage": {
        "net0": {
          "sent_bytes": 6108,
          "received_bytes": 492376,
          "counter_start": "2013-08-14T16:21:29.023Z"
        }
      },
      "disk_usage": {
        "zones/0f778be3-bd2e-431b-baa0-a1c4ef2100e2": {
          "name": "zones/0f778be3-bd2e-431b-baa0-a1c4ef2100e2",
          "used": 4071424,
          "available": 748964864,
          "referenced": 292363776,
          "type": "filesystem",
          "mountpoint": "/zones/0f778be3-bd2e-431b-baa0-a1c4ef2100e2",
          "quota": 26843545600,
          "origin": "zones/e1d03df6-3aa3-4460-8c02-2777c76b1dd8@final",
          "volsize": "-"
        },
        "zones/0f778be3-bd2e-431b-baa0-a1c4ef2100e2@foo": {
          "name": "zones/0f778be3-bd2e-431b-baa0-a1c4ef2100e2@foo",
          "used": 24576,
          "available": "-",
          "referenced": 292363264,
          "type": "snapshot",
          "mountpoint": "-",
          "quota": "-",
          "origin": "-",
          "volsize": "-"
        },
        "zones/cores/0f778be3-bd2e-431b-baa0-a1c4ef2100e2": {
          "name": "zones/cores/0f778be3-bd2e-431b-baa0-a1c4ef2100e2",
          "used": 31744,
          "available": 748964864,
          "referenced": 31744,
          "type": "filesystem",
          "mountpoint": "/zones/0f778be3-bd2e-431b-baa0-a1c4ef2100e2/cores",
          "quota": 107374182400,
          "origin": "-",
          "volsize": "-"
        }
      },
      "v": "1"
    }


## Data Properties

| Property           | Description |
| ------------------ | ----------- |
| `config`           | This represents the contents of the VM's zonecfg definition. It contains the memory and cpu tuning parameters. |
| `config.attribute` | The attr key/value blocks within the VM's zonecfg definition. |
| `config.networks`  | The networks devices attached to this VM
| `network_usage`    | The kstat values for each of this VMs NICs. |
| `disk_usage`       | The zfs values for each of this VM's datasets

## Network Usage

NIC usage is present in the top-level `network_usage` value. This contains
values for values sent and received since the counter was started.

## Disk Usage

Disk usage is present in the top-level `disk_usage` value. This contains a hash
of each dataset belonging to this zone, and the values corresponding to the
following zfs properties:

* `name`
* `used`
* `available`
* `referenced`
* `type`
* `mountpoint`
* `quota`
* `origin`
* `volsize`

## Versioning

Each VM datum must contain a `"v"` key which will identify the version of the
given payload. This version can be used to determine what key-schema.
