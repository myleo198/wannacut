useEffect(() => {

  
  
    if (!topAudios || topAudios.length === 0 || !isPlaying) {
    audioPlayersRef.current.forEach(p => {
      p.pause();
      p.volume = 0;
    });
    return;
  }

  const currentIds = new Set(topAudios.map(clip => clip.id));
  audioPlayersRef.current.forEach((player, id) => {
    if (!currentIds.has(id)) {
      player.pause();
      audioPlayersRef.current.delete(id);
    }
  });

  const keyframeToLinear = (kfValue: number) => {
    const db = (kfValue * 100) - 30;
    return Math.pow(10, db / 20);
  };

  // Função Auxiliar: Calcula em qual segundo do arquivo original o áudio deve estar
  const getAssetTimeAtTimelineTime = (tTime: number, clip: Clip) => {
    if (!clip.keyframes?.speed || clip.keyframes.speed.length === 0) return tTime;
    const speedKfs = [...clip.keyframes.speed].sort((a, b) => a.time - b.time);
    let accumulatedAssetTime = 0;
    let lastT = 0;
    let lastS = speedKfs[0].value;

    for (const kf of speedKfs) {
      if (tTime > kf.time) {
        const dt = kf.time - lastT;
        const avgS = (lastS + kf.value) / 2;
        accumulatedAssetTime += dt * avgS;
        lastT = kf.time;
        lastS = kf.value;
      } else {
        const dt = tTime - lastT;
        const dist = kf.time - lastT || 1;
        const currentS = lastS + (dt / dist) * (kf.value - lastS);
        accumulatedAssetTime += dt * ((lastS + currentS) / 2);
        return accumulatedAssetTime;
      }
    }
    return accumulatedAssetTime + (tTime - lastT) * lastS;
  };

  topAudios.forEach(clip => {
    let player = audioPlayersRef.current.get(clip.id);
    
    const audio = `${clip.name.split('.').slice(0, -1).join('.')}.mp3`;
    const path = knowTypeByAssetName(clip.name) === 'video' 
      ? `http://127.0.0.1:1234/${encodeURIComponent(`${currentProjectPath}/extracted_audios/${audio}`)}` 
      : `http://127.0.0.1:1234/${encodeURIComponent(`${currentProjectPath}/videos/${clip.name}`)}`;

    if (!player) {
      player = new Audio(path);
      // Opcional: mantém o tom original (sem voz de esquilo) ao mudar velocidade
      // player.preservesPitch = true; 
      audioPlayersRef.current.set(clip.id, player);
    }

    const timelineRelativeTime = currentTimeRef.current - clip.start;
    // Calcula o tempo distorcido pela velocidade para o áudio original
    const assetRelativeTime = getAssetTimeAtTimelineTime(timelineRelativeTime, clip);
    const targetTime = assetRelativeTime + (clip.beginmoment || 0);

    const applyFadeAndSync = () => {
      // Sincronia inicial
      if (targetTime >= 0 && targetTime < player!.duration) {
        player!.currentTime = targetTime;
      }
      
      if (isPlaying) player!.play().catch(() => {});

      const updateAudioState = () => {
        if (!player || player.paused) return;

        // 1. SPEED UPDATE (PlaybackRate)
        const currentSpeed = getInterpolatedValueWithFades(currentTimeRef.current, clip, 'speed');
        // O HTML5 Audio suporta playbackRate entre 0.06 e 16.0
        player.playbackRate = Math.max(0.06, Math.min(16, currentSpeed));

        //2. VOLUME CALCULATION
        const relativeTime = player.currentTime - (clip.beginmoment || 0);
        const fadein = clip.fadeinAudio || 0;
        const fadeout = clip.fadeoutAudio || 0;
        
        let fadeVol = 1.0;
        if (relativeTime < fadein && fadein > 0) {
          fadeVol = relativeTime / fadein;
        } else if (relativeTime > (clip.duration - fadeout) && fadeout > 0) {
          const timeRemaining = clip.duration - relativeTime;
          fadeVol = timeRemaining / fadeout;
        }

        const kfValue = getInterpolatedValueWithFades(currentTimeRef.current, clip, 'volume');
        const kfLinear = keyframeToLinear(kfValue);
        player.volume = Math.max(0, Math.min(1, kfLinear * fadeVol));

      // 3. DRIFT CHECK (Forced Sync)
      // If the audio deviates by more than 0.1s from what the integral calculates, we force the timing.
      
      const expectedTime = getAssetTimeAtTimelineTime(currentTimeRef.current - clip.start, clip) + (clip.beginmoment || 0);
        if (Math.abs(player.currentTime - expectedTime) > 0.1) {
           player.currentTime = expectedTime;
        }
        
        if (isPlaying) requestAnimationFrame(updateAudioState);
      };

      updateAudioState();
    };

    if (player.readyState >= 1) { 
      applyFadeAndSync();
    } else {
      player.addEventListener('loadedmetadata', applyFadeAndSync, { once: true });
    }
  });
  
  

}, [topAudios, isPlaying]);


{
      "messages": [
        {
          "id": "update_01",
          "title": "Versão 2.0 Disponível!",
          "type_": "update",
          "description": "Adicionamos os novos efeitos de áudio Alien e Pitch.",
          "image": "https://wannacut.app/img/promo.jpg",
          "link_text": "Check here",
          "link": "https://wannacut.app/blog/v2",
          "repeat": true
        },
        {
          "id": "tip_daily",
          "title": "Dica do Dia",
          "description": "Use a tecla 'S' para cortar clipes rapidamente.",
          "image": null,
          "link": null,
          "repeat": true
        }
      ]
    }