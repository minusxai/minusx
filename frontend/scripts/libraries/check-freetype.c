#include <assert.h>
#include <string.h>
#include <ft2build.h>
#include FT_FREETYPE_H
int main(void) {
 const char font[]="STARTFONT 2.1\nFONT -fixture-fixed-medium-r-normal--8-80-75-75-c-80-iso10646-1\nSIZE 8 75 75\nFONTBOUNDINGBOX 8 8 0 0\nSTARTPROPERTIES 2\nFONT_ASCENT 8\nFONT_DESCENT 0\nENDPROPERTIES\nCHARS 1\nSTARTCHAR A\nENCODING 65\nSWIDTH 1000 0\nDWIDTH 8 0\nBBX 8 8 0 0\nBITMAP\n18\n24\n42\n7E\n42\n42\n42\n00\nENDCHAR\nENDFONT\n";
 FT_Library library;FT_Face face;assert(FT_Init_FreeType(&library)==0);
 assert(FT_New_Memory_Face(library,(const FT_Byte*)font,strlen(font),0,&face)==0);assert(face->num_glyphs>=1);
 assert(FT_Select_Size(face,0)==0);assert(FT_Load_Char(face,'A',FT_LOAD_RENDER)==0);assert(face->glyph->bitmap.width==8 && face->glyph->bitmap.rows==8);
 FT_Done_Face(face);FT_Done_FreeType(library);return 0;
}
