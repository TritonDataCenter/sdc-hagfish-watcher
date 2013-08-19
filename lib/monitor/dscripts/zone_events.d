#pragma D option quiet

/*
 * Zone Transition Events
 */

fbt::zone_status_set:entry
{
  printf("{\"date\":\"%Y\",\"type\":\"zone_status\",\"status\":\"%d\",\"name\":\"%s\"}\n",
      walltimestamp, arg1, stringof(((zone_t *)arg0)->zone_name));
}

/*
 * Zone Resource Control Events
 */

fbt::rctl_hndl_lookup:entry
{
  this->rctlname = stringof(arg0);
}

fbt::rctl_hndl_lookup:return
{
  rname[arg1] = this->rctlname;
  this->rctlname = 0;
}

fbt::rctl_local_delete:entry,
fbt::rctl_local_insert:entry,
fbt::rctl_local_replace:entry
{
  action = (probefunc == "rctl_local_delete"
            ? "delete"
            : (probefunc == "rctl_local_insert"
              ? "insert"
              : "replace"
              )
            );
  zone = stringof(((struct proc *)arg2)->p_zone->zone_name);
  rctl = rname[arg0];
  value = ((rctl_val_t *)arg1)->rcv_value;

  printf("{\"date\":\"%Y\",\"type\":\"zone_rctl\",\"name\":\"%s\",\"action\":\"%s\",\"rctl\":\"%s\",\"value\":%llu}\n",
      walltimestamp, zone, action, rctl, value);
}

/*
 * Zone ZFS Quota Event
 */

zfs_prop_set_special:entry 
/ stringof(arg2 + sizeof(nvpair_t)) == "quota" /
{
  dataset = stringof(arg0);
  name = stringof(arg2 + sizeof(nvpair_t));

  printf("{\"date\":\"%Y\",\"type\":\"zfs_quota\",\"dataset\":\"%s\"}\n",
      walltimestamp, dataset);
}
