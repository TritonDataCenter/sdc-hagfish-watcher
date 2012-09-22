export SMFDIR=$npm_config_smfdir

svcadm disable -s hagfish-watcher
svccfg delete hagfish-watcher

rm -f "$SMFDIR/hagfish-watcher.xml"
