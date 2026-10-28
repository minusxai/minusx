use strict;
use warnings;
use utf8;
use re qw(is_regexp);
use POSIX qw(floor);
use Scalar::Util qw(looks_like_number);
die "core regex XS changed" unless is_regexp(qr/fixture/);
die "core native extensions changed" unless floor(2.75) == 2 && looks_like_number("19.25");
my $text = 'order-42 subtotal=19.25';
$text =~ /order-(\d+) subtotal=([\d.]+)/ or die "ordinary capture failed";
die "capture changed" unless $1 eq '42' && $2 eq '19.25';
my @words = split /\s+/, 'alpha beta gamma';
die "split changed" unless @words == 3 && $words[1] eq 'beta';
my $unicode = 'café';
die "UTF8 match changed" unless $unicode =~ /^caf\x{e9}$/;
my $input = 'aaaaab';
die "nested quantified success changed" unless $input =~ /^(a+)+b$/;
die "nested quantified normal nonmatch changed" if $input =~ /^(a+)+c$/;
my $replace = 'one-42';$replace =~ s/(\d+)/[$1]/;
die "substitution changed" unless $replace eq 'one-[42]';
if (defined $ENV{PERL_FIXTURE_NATIVE_PREFIX}) {
    require DynaLoader;
    die "no actual native XS modules loaded" unless @DynaLoader::dl_shared_objects;
    for my $library (@DynaLoader::dl_shared_objects) {
        die "native XS escaped expected loader prefix" unless index($library, $ENV{PERL_FIXTURE_NATIVE_PREFIX}) == 0;
    }
}
print "PASS ordinary capture/UTF8/split/substitution/nested regex behavior\n";
