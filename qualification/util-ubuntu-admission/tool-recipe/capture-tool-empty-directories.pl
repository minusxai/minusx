# Run BEFORE tool APT via clean env and system core Perl; no JSON::PP or Node.
use strict;
use warnings;
use Cwd qw(abs_path);
my ($requested)=@ARGV;
die "one output path required\n" unless @ARGV==1 && defined $requested;
# Taint mode remains enabled: admit and untaint only this fixed output.
my ($output)=$requested =~ m{\A(/perl-work/original-tool-empty-dirs\.tsv)\z};
die "unexpected capture output path\n" unless defined $output;
die "output exists\n" if -e $output || -l $output;
my %seen;
my @paths=sort grep { -d $_ && m{^/usr/} && !$seen{$_}++ } @INC;
die "no original /usr Perl search paths\n" unless @paths;
open(my $out,'>',$output) or die "cannot create capture\n";
print {$out} "FORMAT\t1\nPERL_VERSION\t",sprintf('%vd',$^V),"\n";
for my $path (@paths) {
    die "unsafe search path\n" unless $path =~ m{\A/usr/[A-Za-z0-9_+./-]+\z} && $path !~ m{(?:\A|/)\.\.(?:/|\z)};
    print {$out} "INC\t$path\n";
    my @st=lstat($path); die "cannot stat search path\n" unless @st;
    next if -l _ || !-d _;
    my $real=abs_path($path); die "search directory escapes /usr\n" unless defined($real) && $real =~ m{\A/usr/};
    opendir(my $dir,$path) or die "cannot inspect search directory\n";
    my @contents=grep { $_ ne '.' && $_ ne '..' } readdir($dir);
    closedir($dir) or die "cannot close search directory\n";
    next if @contents;
    print {$out} join("\t",'EMPTY',$path,$st[2]&07777,$st[4],$st[5]),"\n";
}
close($out) or die "cannot finish capture\n";
