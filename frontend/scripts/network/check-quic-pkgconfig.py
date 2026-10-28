"""Resolve private QUIC modules while retaining native TLS metadata visibility."""
import pathlib,subprocess,sys
prefix=pathlib.Path(sys.argv[1]).resolve()
modules=['libngtcp2','libngtcp2_crypto_ossl','libngtcp2_crypto_gnutls']
subprocess.run(['pkg-config','--print-errors','--exists',*modules],check=True)
for module in modules:
 version=subprocess.check_output(['pkg-config','--modversion',module],text=True).strip()
 libdir=subprocess.check_output(['pkg-config','--variable=libdir',module],text=True).strip()
 assert version=='1.25.0',(module,'Unexpected QUIC version',version)
 assert pathlib.Path(libdir).resolve()==prefix/'lib',(module,'Unexpected QUIC provider',libdir)
print('Verified private ngtcp2 1.25.0 metadata for both native TLS backends')
