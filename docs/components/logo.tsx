import Image from 'next/image';

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <Image
        src="/logo_dark.svg"
        alt="MinusX"
        width={22}
        height={22}
        className="logo-light"
      />
      <Image
        src="/logo.svg"
        alt="MinusX"
        width={22}
        height={22}
        className="logo-dark"
      />
      <span className="text-sm font-semibold tracking-tight">MinusX</span>
    </div>
  );
}
