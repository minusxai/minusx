"""Fail closed on actual generated feature/backend configuration."""
import hashlib,json,pathlib,re,sys
root=pathlib.Path(sys.argv[1]);tls=sys.argv[2];header=root/'lib/curl_config.h';text=header.read_text();defined=set(re.findall(r'^#define\s+(\w+)',text,re.M))
required={'USE_LIBSSH2','USE_OPENLDAP','HAVE_GSSAPI','USE_LIBRTMP','USE_TLS_SRP','USE_NGTCP2','USE_NGHTTP3','USE_GNUTLS' if tls=='gnutls' else 'USE_OPENSSL'}
forbidden={'USE_LIBSSH','USE_WOLFSSL','USE_OPENSSL_QUIC','CURL_DISABLE_IPFS','CURL_DISABLE_SMB','CURL_DISABLE_NTLM','USE_OPENSSL' if tls=='gnutls' else 'USE_GNUTLS'}
assert required<=defined,('Missing generated runtime capabilities',required-defined)
assert not forbidden&defined,('Unexpected backend/disabled protocol',forbidden&defined)
(root/'runtime-config.json').write_text(json.dumps({'tls':tls,'required_defined':sorted(required),'forbidden_undefined':sorted(forbidden),'config_sha256':hashlib.sha256(header.read_bytes()).hexdigest()},indent=2)+'\n')
