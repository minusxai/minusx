#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <gelf.h>
#include <libelf.h>
int main(void) {
 assert(elf_version(EV_CURRENT)!=EV_NONE);FILE *file=tmpfile();assert(file);
 Elf *elf=elf_begin(fileno(file),ELF_C_WRITE,NULL);assert(elf&&gelf_newehdr(elf,ELFCLASS64));
 Elf_Scn *section=elf_newscn(elf);assert(section);GElf_Shdr header;assert(gelf_getshdr(section,&header));header.sh_type=SHT_STRTAB;header.sh_size=8;header.sh_addralign=1;assert(gelf_update_shdr(section,&header));
 /* Valid construction state: a declared new string section before adding data. */
 assert(elf_strptr(elf,elf_ndxscn(section),0)==NULL);
 Elf_Data *data=elf_newdata(section);assert(data);char names[]="\0sample\0";data->d_buf=names;data->d_size=sizeof(names);data->d_type=ELF_T_BYTE;data->d_align=1;data->d_version=EV_CURRENT;
 assert(strcmp(elf_strptr(elf,elf_ndxscn(section),1),"sample")==0);
 elf_end(elf);fclose(file);return 0;
}
