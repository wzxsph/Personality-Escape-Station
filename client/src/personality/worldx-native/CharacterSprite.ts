import Phaser from 'phaser'

export interface SpriteAnimationMeta {
  start?: number
  end?: number
  frameRate?: number
  frame?: number
}

export interface SpriteSheetMeta {
  key: string
  sourceType?: 'spritesheet' | 'frames' | 'image'
  frameWidth: number
  frameHeight: number
  columns: number
  rows: number
  scale: number
  frameKeys?: string[]
  animations: {
    'walk-left': SpriteAnimationMeta
    'walk-right'?: SpriteAnimationMeta
    'walk-down': SpriteAnimationMeta
    'walk-down-left'?: SpriteAnimationMeta
    'walk-down-right'?: SpriteAnimationMeta
    'walk-up': SpriteAnimationMeta
    'walk-up-left'?: SpriteAnimationMeta
    'walk-up-right'?: SpriteAnimationMeta
    'idle-front': SpriteAnimationMeta
    'idle-down'?: SpriteAnimationMeta
    'idle-down-left'?: SpriteAnimationMeta
    'idle-down-right'?: SpriteAnimationMeta
    'idle-right'?: SpriteAnimationMeta
    'idle-back': SpriteAnimationMeta
    'idle-up'?: SpriteAnimationMeta
    'idle-up-left'?: SpriteAnimationMeta
    'idle-up-right'?: SpriteAnimationMeta
    'idle-left': SpriteAnimationMeta
  }
}

type FacingDirection = 'down' | 'down-left' | 'left' | 'up-left' | 'up' | 'up-right' | 'right' | 'down-right'

export class CharacterSprite extends Phaser.GameObjects.Container {
  isMoving = false
  private spriteMeta?: SpriteSheetMeta
  private shadow: Phaser.GameObjects.Ellipse
  private bodySprite: Phaser.GameObjects.Sprite | null
  private moveTween: Phaser.Tweens.Tween | null = null
  private facing: FacingDirection = 'down'
  private readonly hasSprite: boolean

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    color: number,
    spriteMeta?: SpriteSheetMeta,
  ) {
    super(scene, x, y)
    this.spriteMeta = spriteMeta
    this.hasSprite = Boolean(
      spriteMeta &&
        (spriteMeta.sourceType === 'frames'
          ? scene.textures.exists(spriteMeta.frameKeys?.[0] ?? '')
          : scene.textures.exists(spriteMeta.key)),
    )
    this.shadow = scene.add.ellipse(0, 18, 42, 14, 0x000000, 0.3)
    this.bodySprite = this.hasSprite ? this.createSpriteBody() : null
    if (!this.hasSprite) {
      const body = scene.add.rectangle(0, -8, 18, 26, color).setStrokeStyle(3, 0x05070d)
      const head = scene.add.rectangle(0, -28, 24, 22, 0xf7d8a4).setStrokeStyle(3, 0x05070d)
      this.add([this.shadow, body, head])
    } else {
      this.add([this.shadow, this.bodySprite!])
    }
    scene.add.existing(this)
  }

  private createSpriteBody() {
    if (!this.spriteMeta) {
      return null
    }
    const sprite = this.spriteMeta.sourceType === 'image'
      ? this.scene.add.sprite(0, 0, this.spriteMeta.key)
      : this.spriteMeta.sourceType === 'frames'
        ? this.scene.add.sprite(0, 0, this.getFrameTextureKey(this.spriteMeta.animations['idle-front'].frame ?? 0))
        : this.scene.add.sprite(0, 0, this.spriteMeta.key, this.spriteMeta.animations['idle-front'].frame ?? 0)
    sprite.setOrigin(0.5, 0.86)
    sprite.setScale(this.spriteMeta.scale)
    this.bodySprite = sprite
    this.ensureAnimations()
    this.setIdleFrame('down')
    return sprite
  }

  private ensureAnimations() {
    if (!this.spriteMeta) {
      return
    }
    const prefix = `${this.spriteMeta.key}_`
    const animations = this.scene.anims
    if (this.spriteMeta.sourceType === 'image') {
      return
    }
    const register = (
      name:
        | 'walk-down'
        | 'walk-down-left'
        | 'walk-left'
        | 'walk-up-left'
        | 'walk-up'
        | 'walk-up-right'
        | 'walk-right'
        | 'walk-down-right',
    ) => {
      const meta = this.spriteMeta!.animations[name]
      const key = `${prefix}${name}`
      if (animations.exists(key) || !meta || meta.start == null || meta.end == null) {
        return
      }
      const frames =
        this.spriteMeta?.sourceType === 'frames'
          ? buildFrameAnimationFrames(this.spriteMeta.frameKeys ?? [], meta.start, meta.end)
          : animations.generateFrameNumbers(this.spriteMeta!.key, { start: meta.start, end: meta.end })
      animations.create({
        key,
        frames,
        frameRate: meta.frameRate ?? 8,
        repeat: -1,
      })
    }
    register('walk-left')
    register('walk-right')
    register('walk-down')
    register('walk-down-left')
    register('walk-down-right')
    register('walk-up')
    register('walk-up-left')
    register('walk-up-right')
  }

  private setIdleFrame(direction: FacingDirection) {
    if (!this.bodySprite || !this.spriteMeta) {
      return
    }
    this.bodySprite.stop()
    const animations = this.spriteMeta.animations
    const setDirectFrame = (primary: keyof SpriteSheetMeta['animations'], fallback: number, flipX = false) => {
      this.bodySprite!.flipX = flipX
      this.setFrameTexture(animations[primary]?.frame ?? fallback)
    }
    switch (direction) {
      case 'up':
        setDirectFrame('idle-up', animations['idle-back'].frame ?? 0)
        break
      case 'up-left':
        setDirectFrame('idle-up-left', animations['idle-left'].frame ?? animations['idle-back'].frame ?? 0)
        break
      case 'up-right':
        if (animations['idle-up-right']?.frame != null) {
          setDirectFrame('idle-up-right', animations['idle-up-right'].frame)
          break
        }
        setDirectFrame('idle-up-left', animations['idle-left'].frame ?? animations['idle-back'].frame ?? 0, true)
        break
      case 'left':
        setDirectFrame('idle-left', animations['idle-left'].frame ?? 0)
        break
      case 'right':
        if (animations['idle-right']?.frame != null) {
          setDirectFrame('idle-right', animations['idle-right'].frame)
          break
        }
        setDirectFrame('idle-left', animations['idle-left'].frame ?? 0, true)
        break
      case 'down-left':
        setDirectFrame('idle-down-left', animations['idle-left'].frame ?? animations['idle-front'].frame ?? 0)
        break
      case 'down-right':
        if (animations['idle-down-right']?.frame != null) {
          setDirectFrame('idle-down-right', animations['idle-down-right'].frame)
          break
        }
        setDirectFrame('idle-down-left', animations['idle-left'].frame ?? animations['idle-front'].frame ?? 0, true)
        break
      case 'down':
      default:
        setDirectFrame('idle-down', animations['idle-front'].frame ?? 0)
        break
    }
  }

  private playWalkAnimation(direction: FacingDirection) {
    if (!this.bodySprite || !this.spriteMeta) {
      return
    }
    if (this.spriteMeta.sourceType === 'image') {
      this.setIdleFrame(direction)
      return
    }
    const prefix = `${this.spriteMeta.key}_`
    const play = (name: string, fallbackNames: string[], flipX = false) => {
      this.bodySprite!.flipX = flipX
      const animationKey = [name, ...fallbackNames]
        .map((item) => `${prefix}${item}`)
        .find((key) => this.scene.anims.exists(key))
      if (animationKey) {
        this.bodySprite!.play(animationKey, true)
      } else {
        this.setIdleFrame(direction)
      }
    }
    switch (direction) {
      case 'up':
        play('walk-up', ['walk-down'])
        break
      case 'up-left':
        play('walk-up-left', ['walk-up', 'walk-left'])
        break
      case 'up-right':
        play('walk-up-right', ['walk-up-left', 'walk-up', 'walk-right', 'walk-left'], !this.scene.anims.exists(`${prefix}walk-up-right`))
        break
      case 'left':
        play('walk-left', ['walk-down'])
        break
      case 'right':
        play('walk-right', ['walk-left', 'walk-down'], !this.scene.anims.exists(`${prefix}walk-right`))
        break
      case 'down-left':
        play('walk-down-left', ['walk-down', 'walk-left'])
        break
      case 'down-right':
        play('walk-down-right', ['walk-down-left', 'walk-down', 'walk-right', 'walk-left'], !this.scene.anims.exists(`${prefix}walk-down-right`))
        break
      case 'down':
      default:
        play('walk-down', ['walk-left'])
        break
    }
  }

  private getDirectionTo(targetX: number, targetY: number): FacingDirection {
    const dx = targetX - this.x
    const dy = targetY - this.y
    const degrees = Phaser.Math.RadToDeg(Math.atan2(dy, dx))
    if (degrees >= -22.5 && degrees < 22.5) return 'right'
    if (degrees >= 22.5 && degrees < 67.5) return 'down-right'
    if (degrees >= 67.5 && degrees < 112.5) return 'down'
    if (degrees >= 112.5 && degrees < 157.5) return 'down-left'
    if (degrees >= -67.5 && degrees < -22.5) return 'up-right'
    if (degrees >= -112.5 && degrees < -67.5) return 'up'
    if (degrees >= -157.5 && degrees < -112.5) return 'up-left'
    return 'left'
  }

  walkAlongPath(path: { x: number; y: number }[], onComplete?: () => void) {
    if (this.isMoving) {
      this.stopMoving()
    }
    this.isMoving = true
    let index = 0

    const walkNext = () => {
      if (index >= path.length) {
        this.isMoving = false
        this.moveTween = null
        this.setIdleFrame(this.facing)
        onComplete?.()
        return
      }

      const target = path[index]
      const distance = Phaser.Math.Distance.Between(this.x, this.y, target.x, target.y)
      const duration = Math.max(55, (distance / 150) * 1000)
      this.facing = this.getDirectionTo(target.x, target.y)
      this.playWalkAnimation(this.facing)

      this.moveTween = this.scene.tweens.add({
        targets: this,
        x: target.x,
        y: target.y,
        duration,
        ease: 'Linear',
        onUpdate: () => {
          this.depth = this.getSortFootY()
        },
        onComplete: () => {
          index += 1
          walkNext()
        },
      })
    }

    walkNext()
  }

  moveWithVector(deltaX: number, deltaY: number) {
    if (deltaX === 0 && deltaY === 0) {
      this.stopMoving()
      return
    }

    if (this.moveTween) {
      this.moveTween.stop()
      this.moveTween = null
    }

    this.isMoving = true
    this.facing = this.getDirectionTo(this.x + deltaX, this.y + deltaY)
    this.playWalkAnimation(this.facing)
    this.x += deltaX
    this.y += deltaY
    this.depth = this.getSortFootY()
  }

  stopMoving() {
    if (this.moveTween) {
      this.moveTween.stop()
      this.moveTween = null
    }
    this.isMoving = false
    this.setIdleFrame(this.facing)
  }

  faceTowards(otherX: number, otherY: number) {
    this.facing = this.getDirectionTo(otherX, otherY)
    this.setIdleFrame(this.facing)
  }

  getSortFootY() {
    return this.y + (this.bodySprite?.displayHeight ?? 28) * 0.08
  }

  private setFrameTexture(frameIndex: number) {
    if (!this.bodySprite || !this.spriteMeta) {
      return
    }

    if (this.spriteMeta.sourceType === 'frames') {
      this.bodySprite.setTexture(this.getFrameTextureKey(frameIndex))
      return
    }

    if (this.spriteMeta.sourceType === 'image') {
      this.bodySprite.setTexture(this.spriteMeta.key)
      return
    }

    this.bodySprite.setFrame(frameIndex)
  }

  private getFrameTextureKey(frameIndex: number) {
    return this.spriteMeta?.frameKeys?.[frameIndex] ?? this.spriteMeta?.key ?? ''
  }
}

function buildFrameAnimationFrames(frameKeys: string[], start: number, end: number) {
  return frameKeys.slice(start, end + 1).map((key) => ({ key }))
}
