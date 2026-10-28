#-------------------------------------------------------------------------
#
reset_db
set CS 540101740017000003ffffffff

do_test 9.0 {
  set C [db one {SELECT unhex($CS)}]
  list [catch { sqlite3changeset_concat $C $C } msg] $msg
} {1 SQLITE_CORRUPT}



