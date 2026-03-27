import { Suspense } from 'react';
import { HelloWorldContent } from './HelloWorldContent';

export default function HelloWorldPage() {
  return (
    <Suspense>
      <HelloWorldContent />
    </Suspense>
  );
}
