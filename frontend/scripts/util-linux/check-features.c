/* Stable public ABI declarations avoid requiring a bootstrapped -dev package. */
#include <stdio.h>
extern int mnt_get_library_features(const char ***features);

int main(void) {
    const char **features = NULL;
    int count = mnt_get_library_features(&features);
    if (count <= 0 || !features) return 1;
    for (int i = 0; i < count; i++) {
        if (!features[i] || !*features[i]) return 2;
        puts(features[i]);
    }
    return 0;
}
