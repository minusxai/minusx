
#-------------------------------------------------------------------------
reset_db

do_execsql_test 7.0 {
  PRAGMA trusted_schema=OFF;
  PRAGMA foreign_keys=ON;
  CREATE TABLE t1(a INTEGER PRIMARY KEY, b, c, d);
  CREATE TABLE t2(e TEXT PRIMARY KEY NOT NULL, f, g);
  CREATE TABLE t3(w REAL PRIMARY KEY NOT NULL, x, y);
  CREATE TABLE t4(z PRIMARY KEY) WITHOUT ROWID;
  CREATE TABLE tc(a INTEGER, b INTEGER, c BLOB, d TEXT, PRIMARY KEY(a,b));
  CREATE TABLE wr(a TEXT, b INT, c, PRIMARY KEY(a,b)) WITHOUT ROWID;
  CREATE TABLE child(x INTEGER PRIMARY KEY, y INTEGER REFERENCES t1(a) ON DELETE CASCADE, z TEXT);
  INSERT INTO t1 VALUES(1,2,3,4),(2,3.5,'four',x'556677'),(3,NULL,'xyz',15),(4,'bubba',2147483648,0.0);
  INSERT INTO t1 SELECT a+4,c,d,b FROM t1;
  INSERT INTO t2 VALUES('x1y',2,3),('x2y','four',x'556677'),('x3y',NULL,'xyz');
  INSERT INTO t3 VALUES(1.1,'a','b'),(2.2,x'00ff','c');
  INSERT INTO t4 VALUES('alpha'),('beta'),('gamma');
  INSERT INTO tc VALUES(1,1,x'0102','one'),(1,2,x'0304','two'),(2,1,x'0506','three');
  INSERT INTO wr VALUES('a',1,'wa'),('b',2,'wb');
  INSERT INTO child VALUES(1,1,'c1'),(2,2,'c2');
}

set C [db one "SELECT unhex('
      54 0401 0200 0074 6300 1700 0100 0000
    0000 0000 0101 0000 0000 0069 0001 0402
    0102 0303 6f6e 6500 0004 2008 40a1 4c0b
    0d3f 3730 5d92 3f18 f2c9 66a6 4220 a873
    04cc 5281 ce5c d9d4 dc8b 7003 056f 6e65
    2d75 1700 0100 0002 5004 0100 0000 6d69
    7800 1700 0302 6b31 0409 1100
', ' \n')"]


proc conflict_handler {args} { 
  return "OMIT" 
}
do_test 7.1 {
  list [catch {sqlite3changeset_apply_v2 db $::C conflict_handler} msg] $msg
} {1 SQLITE_CORRUPT}
