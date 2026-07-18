import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const telegramId = searchParams.get('telegram_id');

    if (!telegramId) {
      return NextResponse.json({ photo_url: null });
    }

    // Кэш в Supabase
    const { data: cached } = await getSupabase()
      .from('tma_user_avatars')
      .select('photo_url')
      .eq('telegram_id', Number(telegramId))
      .gt('expires_at', new Date().toISOString())
      .single();

    if (cached?.photo_url) {
      return NextResponse.json({ photo_url: cached.photo_url });
    }

    // Bot API: getUserProfilePhotos
    const botToken = process.env.ADMIN_BOT_TOKEN;
    if (!botToken) return NextResponse.json({ photo_url: null });

    const photoRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${telegramId}&limit=1`,
    );
    const photoData = await photoRes.json();
    const photo = photoData.result?.photos?.[0];

    if (!photo) return NextResponse.json({ photo_url: null });

    // Максимальный размер фото
    const bestPhoto = photo[photo.length - 1];
    const fileId: string = bestPhoto.file_id;

    // Получаем file_path
    const fileRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
    );
    const fileData = await fileRes.json();

    if (!fileData.result?.file_path) {
      return NextResponse.json({ photo_url: null });
    }

    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;

    // Кэш на 24 часа
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await getSupabase()
      .from('tma_user_avatars')
      .upsert(
        { telegram_id: Number(telegramId), photo_url: fileUrl, expires_at: expiresAt },
        { onConflict: 'telegram_id' },
      );

    return NextResponse.json({ photo_url: fileUrl });
  } catch {
    return NextResponse.json({ photo_url: null });
  }
}
