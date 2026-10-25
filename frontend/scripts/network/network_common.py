"""Read real loaded curl feature/ABI metadata."""
import ctypes
def capabilities(path):
 class Info(ctypes.Structure):
  _fields_=[('age',ctypes.c_int),('version',ctypes.c_char_p),('version_num',ctypes.c_uint),('host',ctypes.c_char_p),('features',ctypes.c_int),('ssl_version',ctypes.c_char_p),('ssl_version_num',ctypes.c_long),('libz_version',ctypes.c_char_p),('protocols',ctypes.POINTER(ctypes.c_char_p))]
 lib=ctypes.CDLL(str(path));lib.curl_version_info.argtypes=[ctypes.c_int];lib.curl_version_info.restype=ctypes.POINTER(Info);info=lib.curl_version_info(0).contents
 protocols=[];i=0
 while info.protocols[i]:protocols.append(info.protocols[i].decode());i+=1
 return {'features':info.features,'protocols':protocols,'version':info.version.decode(),'ssl_version':info.ssl_version.decode()}
