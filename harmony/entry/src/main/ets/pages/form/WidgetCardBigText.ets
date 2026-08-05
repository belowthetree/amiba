// ============================================================
// 变形虫桌面卡片 · bigText 模板（对应 Android res/layout/widget_card_bigtext.xml）
// 标题行 + 大字内容（lines[0]，垂直居中，22sp 粗体，最多 3 行）+ footer
// ============================================================
@Entry
@Component
struct WidgetCardBigText {
  @LocalStorageProp('title') title: string = '变形虫'
  @LocalStorageProp('icon') icon: string = ''
  @LocalStorageProp('accent') accent: string = ''
  @LocalStorageProp('text_color') textColor: string = ''
  @LocalStorageProp('bg_color') bgColor: string = ''
  @LocalStorageProp('hide_title') hideTitle: boolean = false
  @LocalStorageProp('footer') footer: string = ''
  @LocalStorageProp('tap_path') tapPath: string = ''
  @LocalStorageProp('card_id') cardId: string = ''
  @LocalStorageProp('big_text') bigText: string = ''

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

      // gravity center_vertical：包一层 Column 居中（layoutWeight 吃满剩余高度）
      Column() {
        Text(this.bigText)
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor.length > 0 ? this.textColor : '#FFFFFF')
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      .width('100%')
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
      .margin({ top: 4 })

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
