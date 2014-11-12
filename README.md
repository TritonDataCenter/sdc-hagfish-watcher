<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# SDC Hagfish Watcher

This repository is part of the SmartDataCenter (SDC) project. For
contribution guidelines, issues, and general documentation, visit the
[main SDC project](http://github.com/joyent/sdc).

The `hagfish-watcher` agent is the SDC service for
recording telemetry about customer workloads for usage monitoring and billing
purposes. This agent runs on every compute node, writing
usage records that describe customer instances and their disk and network
usage to disk files once per minute. Usage data is aggregated into
hourly files. These usage files may be archived by
the operator, potentially using the SDC log archival service, [hermes][hermes].

## License

SDC Hagfish Watcher is licensed under the
[Mozilla Public License version 2.0](http://mozilla.org/MPL/2.0/).
See the file LICENSE.

[hermes]: https://github.com/joyent/sdc-hermes
