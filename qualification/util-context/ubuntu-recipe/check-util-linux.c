#include <libmount.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "original-features.h"

int main(void) {
    const char *version = NULL;
    const char **features = NULL;
    if (mnt_get_library_version(&version) <= 0 || !version ||
        strcmp(version, "2.42.2") != 0) return 1;
    int count = mnt_get_library_features(&features);
    if (count <= 0 || !features) return 2;
    size_t original_count = sizeof(original_features) / sizeof(original_features[0]) - 1;
    if ((size_t)count != original_count) return 6;
    for (size_t original = 0; original < original_count; original++) {
        int found = 0;
        for (int i = 0; i < count; i++)
            if (strcmp(original_features[original], features[i]) == 0) found = 1;
        if (!found) return 7;
    }
    for (int i = 0; i < count; i++) {
        if (strcmp(features[i], "fd-based-mount") == 0) return 3;
    }
    struct libmnt_fs *fs = mnt_new_fs();
    if (!fs) return 4;
    int result = mnt_fs_set_source(fs, "/dev/null") ||
                 mnt_fs_set_target(fs, "/tmp") ||
                 mnt_fs_set_fstype(fs, "tmpfs") ||
                 mnt_fs_set_options(fs, "ro,nosuid,nodev");
    if (!result) {
        result = strcmp(mnt_fs_get_source(fs), "/dev/null") ||
                 strcmp(mnt_fs_get_target(fs), "/tmp") ||
                 strcmp(mnt_fs_get_fstype(fs), "tmpfs") ||
                 strcmp(mnt_fs_get_options(fs), "ro,nosuid,nodev");
    }
    mnt_unref_fs(fs);
    if (result) return 5;
    puts("Installed libmount version, public API and disabled mountfd feature passed");
    return 0;
}
