#pragma D option quiet

fbt::zone_create:entry
{
  this->zonename = stringof(copyinstr(arg0));
  printf("{\"date\":\"%Y\",\"function\":\"%s:entry\",\"name\":\"%s\",\"debugid\":\"\"}\n", 
      walltimestamp, probefunc, this->zonename);
}

fbt::zone_create:return
/errno != 0/
{
  this->zonename = stringof(copyinstr(arg0));
  printf("{\"date\":\"%Y\",\"function\":\"%s:return\",\"name\":\"%s\",\"debugid\":\"%d\",\"error\":\"%d\"}\n", 
      walltimestamp, probefunc, this->zonename, arg1, errno);
  this->zonename=0;
}

fbt::zone_create:return
/errno == 0/
{
  printf("{\"date\":\"%Y\",\"function\":\"%s:return\",\"name\":\"%s\",\"debugid\":\"%d\"}\n", 
      walltimestamp, probefunc, this->zonename, arg1);
  this->zonename=0;
}

fbt::zsched:entry
{
  printf("{\"date\":\"%Y\",\"function\":\"%s:entry\",\"name\":\"\",\"debugid\":\"%d\"}\n", 
      walltimestamp, probefunc, ((struct zsched_arg *)args[0])->zone->zone_id);
}

fbt::zone_start_init:entry
{
  printf("{\"date\":\"%Y\",\"function\":\"%s:entry\",\"name\":\"\",\"debugid\":\"%d\"}\n", 
      walltimestamp, probefunc, curpsinfo->pr_zoneid);
}

fbt::zone_boot:entry
{
  this->zoneid=args[0];
}

fbt::zone_boot:return
/errno != 0/
{ 
  printf("{\"date\":\"%Y\",\"function\":\"%s\",\"name\":\"\",\"debugid\":\"%d\",\"error\":\"%d\"}\n", 
      walltimestamp, probefunc, this->zoneid, errno);
  this->zoneid=0;
}

fbt::zone_boot:return
/errno == 0/
{
  printf("{\"date\":\"%Y\",\"function\":\"%s:return\",\"name\":\"\",\"debugid\":\"%d\"}\n", 
      walltimestamp, probefunc, this->zoneid);
  this->zoneid=0;
}

fbt::zone_empty:entry
{
  this->zoneid=((zone_t *)args[0])->zone_id;
  printf("{\"date\":\"%Y\",\"function\":\"%s:entry\",\"name\":\"\",\"debugid\":\"%d\"}\n", 
      walltimestamp, probefunc, this->zoneid);
}

fbt::zone_empty:return
{
  printf("{\"date\":\"%Y\",\"function\":\"%s:return\",\"name\":\"\",\"debugid\":\"%d\"}\n", 
      walltimestamp, probefunc, this->zoneid);
}

fbt::zone_shutdown:entry,
fbt::zone_destroy:entry
{
  printf("{\"date\":\"%Y\",\"function\":\"%s\",\"name\":\"\",\"debugid\":\"%d\"}\n", 
      walltimestamp, probefunc, args[0]);
  this->zoneid=args[0];
}

fbt::zone_shutdown:return,
fbt::zone_destroy:return
/errno != 0/
{
  printf("{\"date\":\"%Y\",\"function\":\"%s\",\"name\":\"\",\"debugid\":\"%d\",\"error\":\"%d\"}\n", 
      walltimestamp, probefunc, this->zoneid, errno);
  this->zoneid=0;
}
