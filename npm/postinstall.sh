#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2015 Joyent, Inc.
#

if [[ "${SDC_AGENT_SKIP_LIFECYCLE:-no}" = "yes" ]]; then
    printf 'Running during package build; skipping lifecycle script.\n' >&2
    exit 0
fi

. /lib/sdc/config.sh
load_sdc_config

set -o errexit
set -o pipefail
set -o xtrace

DIR="$(cd `dirname $0`/ 2>/dev/null && pwd)"

export PREFIX=$npm_config_prefix
export ETC_DIR=$npm_config_etc
export SMF_DIR=$npm_config_smfdir
export VERSION=$npm_package_version
export PKGROOT=$(cd $DIR/..; pwd)

subfile () {
  IN=$1
  OUT=$2
  sed -e "s#@@PREFIX@@#$PREFIX#g" \
      -e "s/@@VERSION@@/$VERSION/g" \
      -e "s#@@PKGROOT@@#$PKGROOT#g" \
      $IN > $OUT
}

cp $DIR/../config/config.json{.in,}

subfile "$DIR/../smf/manifests/hagfish-watcher.xml.in" \
  "$SMF_DIR/hagfish-watcher.xml"
svccfg import $SMF_DIR/hagfish-watcher.xml
