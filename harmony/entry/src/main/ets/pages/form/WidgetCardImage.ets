// ============================================================
// 变形虫桌面卡片 · image 模板（对应 Android res/layout/widget_card_image.xml）
// 标题行 + 图片（centerCrop 充满剩余空间）+ footer；无图时图片整体隐藏
// 图片经 formImages 机制：fd 由 FormStore 随 updateForm 传入，
// 卡面以 memory://card_image 引用（键名固定，见 FormStore.IMAGE_KEY）
// ============================================================
@Entry
@Component
struct WidgetCardImage {
  @LocalStorageProp('title') title: string = '变形虫'
  @LocalStorageProp('icon') icon: string = ''
  @LocalStorageProp('accent') accent: string = ''
  @LocalStorageProp('bg_color') bgColor: string = ''
  @LocalStorageProp('hide_title') hideTitle: boolean = false
  @LocalStorageProp('footer') footer: string = ''
  @LocalStorageProp('tap_path') tapPath: string = ''
  @LocalStorageProp('card_id') cardId: string = ''
  @LocalStorageProp('image_name') imageName: string = ''

  build() {
    Column() {
      if (!this.hideTitle) {
        Row() {
          if (this.icon.length > 0) {
            Text(this.icon)
              .fontSize(16)
              .margin({ right: 6 })
          }
          Text(this.title)
            .fontSize(15)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.accent.length > 0 ? this.accent : '#EEEEEE')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
      }

      if (this.imageName.length > 0) {
        Image(`memory://${this.imageName}`)
          .width('100%')
          .layoutWeight(1)
          .margin({ top: 8 })
          // 对齐 Android centerCrop
          .objectFit(ImageFit.Cover)
      }

      if (this.footer.length > 0) {
        Text(this.footer)
          .fontSize(10)
          .fontColor('#88FFFFFF')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
          .margin({ top: 6 })
      }
    }
    .width('100%')
    .height('100%')
    .padding(12)
    .backgroundColor(this.bgColor.length > 0 ? this.bgColor : '#E61E1E22')
    .borderRadius(16)
    .onClick(() => {
      postCardAction(this, {
        action: 'router',
        abilityName: 'EntryAbility',
        params: { tapPath: this.tapPath, cardId: this.cardId }
      })
    })
  }
}
