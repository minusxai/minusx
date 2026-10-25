#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include <krb5.h>
#include <gssapi/gssapi.h>
#include <gssapi/gssapi_krb5.h>
int main(void) {
 krb5_context context;krb5_principal principal;char *name=NULL;
 assert(krb5_init_context(&context)==0);
 assert(krb5_parse_name(context,"fixture@EXAMPLE.INVALID",&principal)==0);
 assert(krb5_unparse_name(context,principal,&name)==0);assert(strcmp(name,"fixture@EXAMPLE.INVALID")==0);
 krb5_keyblock key={0};assert(krb5_c_make_random_key(context,ENCTYPE_AES256_CTS_HMAC_SHA1_96,&key)==0);
 char bytes[]="ordinary encryption fixture";krb5_data input={0},output={0};input.data=bytes;input.length=sizeof(bytes);
 size_t length;assert(krb5_c_encrypt_length(context,key.enctype,input.length,&length)==0);
 krb5_enc_data encrypted={0};encrypted.ciphertext.data=malloc(length);encrypted.ciphertext.length=length;assert(encrypted.ciphertext.data);
 assert(krb5_c_encrypt(context,&key,42,NULL,&input,&encrypted)==0);
 char plain[128];output.data=plain;output.length=sizeof(plain);assert(krb5_c_decrypt(context,&key,42,NULL,&encrypted,&output)==0);assert(output.length==input.length && memcmp(output.data,input.data,input.length)==0);
 OM_uint32 minor;gss_name_t imported=GSS_C_NO_NAME;gss_buffer_desc buffer={strlen(name),name},display=GSS_C_EMPTY_BUFFER;
 assert(gss_import_name(&minor,&buffer,GSS_KRB5_NT_PRINCIPAL_NAME,&imported)==GSS_S_COMPLETE);
 assert(gss_display_name(&minor,imported,&display,NULL)==GSS_S_COMPLETE);assert(display.length==strlen(name)&&memcmp(display.value,name,display.length)==0);
 gss_release_buffer(&minor,&display);gss_release_name(&minor,&imported);free(encrypted.ciphertext.data);krb5_free_keyblock_contents(context,&key);krb5_free_unparsed_name(context,name);krb5_free_principal(context,principal);krb5_free_context(context);return 0;
}
