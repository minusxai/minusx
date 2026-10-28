#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include <p11-kit/uri.h>
int main(void) {
 P11KitUri *uri=p11_kit_uri_new();assert(uri);
 assert(p11_kit_uri_parse("pkcs11:token=Fixture;object=ordinary%20key;type=private",P11_KIT_URI_FOR_ANY,uri)==P11_KIT_URI_OK);
 char *text=NULL;assert(p11_kit_uri_format(uri,P11_KIT_URI_FOR_ANY,&text)==P11_KIT_URI_OK);
 assert(text&&strstr(text,"token=Fixture")&&strstr(text,"object=ordinary%20key"));free(text);p11_kit_uri_free(uri);return 0;
}
