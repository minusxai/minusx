#include <curl/curl.h>
#include <stdio.h>
#include <string.h>

static size_t receive(char *data, size_t size, size_t count, void *unused) {
  (void)unused;
  return fwrite(data, size, count, stdout) * size;
}

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  const curl_version_info_data *info = curl_version_info(CURLVERSION_NOW);
  if (!info || strcmp(info->version, "8.23.0") != 0 || !info->ssl_version ||
      strncmp(info->ssl_version, "OpenSSL/", 8) != 0) return 3;
  if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) return 4;
  CURL *handle = curl_easy_init();
  if (!handle) { curl_global_cleanup(); return 5; }
  char error[CURL_ERROR_SIZE] = {0};
  CURLcode status = curl_easy_setopt(handle, CURLOPT_URL, argv[1]);
#define OPTION(key, value) do { if (status == CURLE_OK) status = curl_easy_setopt(handle, key, value); } while (0)
  OPTION(CURLOPT_CAINFO, argv[2]);
  OPTION(CURLOPT_NOPROXY, "*");
  OPTION(CURLOPT_SSL_VERIFYPEER, 1L);
  OPTION(CURLOPT_SSL_VERIFYHOST, 2L);
  OPTION(CURLOPT_TIMEOUT, 10L);
  OPTION(CURLOPT_ERRORBUFFER, error);
  OPTION(CURLOPT_WRITEFUNCTION, receive);
  if (status == CURLE_OK) status = curl_easy_perform(handle);
  if (status != CURLE_OK) fprintf(stderr, "TLS fixture failed: %s %s\n", curl_easy_strerror(status), error);
  curl_easy_cleanup(handle);
  curl_global_cleanup();
  return status == CURLE_OK ? 0 : 1;
}
