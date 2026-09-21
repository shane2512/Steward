import { Suspense } from 'react';
import { ActivityScreen } from '@/components/activity/ActivityScreen';

export const metadata = { title: 'Activity - Steward' };

export default function ActivityPage() {
  // useSearchParams (for ?open=<id>) needs a Suspense boundary
  return (
    <Suspense fallback={null}>
      <ActivityScreen />
    </Suspense>
  );
}
